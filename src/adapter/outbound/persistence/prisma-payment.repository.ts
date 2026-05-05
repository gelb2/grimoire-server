import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { PaymentRepositoryPort, PaymentRecord } from '@domain/port/outbound/payment-repository.port'

@Injectable()
export class PrismaPaymentRepository implements PaymentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { authorId: string; productId: string; amount: number; credits: number }): Promise<PaymentRecord> {
    return this.prisma.payment.create({ data: { ...data, status: 'pending' } }) as unknown as PaymentRecord
  }

  async findByExternalTransactionId(tradeNo: string): Promise<PaymentRecord | null> {
    return this.prisma.payment.findUnique({ where: { externalTransactionId: tradeNo } }) as unknown as PaymentRecord | null
  }

  async updateExternalTransactionId(paymentId: string, tradeNo: string): Promise<void> {
    await this.prisma.payment.update({ where: { id: paymentId }, data: { externalTransactionId: tradeNo } })
  }

  async findByAuthorId(authorId: string): Promise<PaymentRecord[]> {
    return this.prisma.payment.findMany({ where: { authorId }, orderBy: { createdAt: 'desc' } }) as unknown as PaymentRecord[]
  }

  async completePaymentAtomically(paymentId: string, authorId: string, credits: number, productId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'completed', completedAt: new Date() },
      })
      await tx.author.update({
        where: { id: authorId },
        data: { credits: { increment: credits } },
      })
      await tx.creditLog.create({
        data: { authorId, amount: credits, reason: `purchase_${productId}_${paymentId}` },
      })
    })
  }

  async updateStatus(paymentId: string, status: string): Promise<void> {
    await this.prisma.payment.update({ where: { id: paymentId }, data: { status } })
  }

  /**
   * pending Payment 중 createdAt이 N시간 이상 경과한 row 조회 (Sprint PAY-P0-2).
   * cron이 expire 대상 후보를 식별할 때 사용.
   */
  async findPendingPaymentsOlderThan(hours: number): Promise<PaymentRecord[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
    return (await this.prisma.payment.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
    })) as unknown as PaymentRecord[]
  }

  /**
   * pending Payment를 expired로 만료 처리 (Sprint PAY-P0-2).
   * - status가 pending일 때만 expired로 갱신 (이미 다른 상태면 skip).
   * - 크레딧 변동 0건 — payment 미완료였으므로 환수 대상 아님.
   */
  async expirePayment(paymentId: string): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { id: paymentId, status: 'pending' },
      data: { status: 'expired' },
    })
  }

  /**
   * Sprint PAY-P1-3 — 결제 실패 retry 정책 (정본: `.claude/shared-contracts.md` §14).
   * 24h 이내 동일 productId pending row 1건 조회 (재사용 후보).
   *
   * - WHERE: authorId AND productId AND status='pending' AND createdAt > expireSince
   * - ORDER BY: createdAt DESC (가장 최근 row 우선 — 사용자가 최근에 시작한 결제 재사용)
   * - LIMIT: 1
   *
   * race condition 차단:
   * - PaymentUseCase.initiatePayment에서 본 메서드는 단일 호출 (트랜잭션 락 도입은 후속 P2)
   * - 현재는 "두 번째 호출이 첫 번째 row를 재사용"하면 충분 (DB row 폭주 차단이 핵심 KPI)
   * - 동시 신규 생성 시 partial unique index는 schema 변경 비용으로 P2 보류
   */
  async findReusablePendingPayment(
    authorId: string,
    productId: string,
    expireSince: Date,
  ): Promise<PaymentRecord | null> {
    return (await this.prisma.payment.findFirst({
      where: {
        authorId,
        productId,
        status: 'pending',
        createdAt: { gt: expireSince },
      },
      orderBy: { createdAt: 'desc' },
    })) as unknown as PaymentRecord | null
  }

  /**
   * 환불 원자 처리 — payment.status='refunded' + Author.credits decrement(0 fix) + CreditLog(음수) + RefundLog 박제
   * (Sprint PAY-P1-1 신설, PAY-P2-1 부분 환불 비율 계산 보강 — 정본: `.claude/shared-contracts.md` §13 + §17)
   *
   * $transaction 내부 처리 순서:
   *   1. tx.payment.findUniqueOrThrow — payment.amount 조회 (부분 환불 비율 계산용)
   *   2. validation: refundedAmount ≤ payment.amount + payment.amount > 0
   *   3. ratio = refundedAmount / payment.amount (0 < ratio ≤ 1.0)
   *   4. proportionalCredits = Math.floor(credits * ratio) — 사용자 우호 floor 정책
   *   5. tx.payment.update — status='refunded' (전액 시) | 'partial_refunded' (부분 시)
   *   6. tx.author.findUnique — 현재 잔액 조회
   *   7. actualDeducted = Math.min(currentBalance, proportionalCredits) (0 fix 보장)
   *   8. deficitCredits = Math.max(0, proportionalCredits - currentBalance)
   *   9. tx.author.update — credits decrement(actualDeducted)
   *  10. tx.creditLog.create — amount=-actualDeducted (음수, 대칭)
   *  11. tx.refundLog.create — paymentId/amount/credits/deficitCredits/reason/source
   *
   * 비율 정책 (PAY-P2-1):
   *   - ratio === 1.0 (전액 환불): proportionalCredits = credits (PAY-P1-1 회귀 보존)
   *   - 0 < ratio < 1.0 (부분 환불): proportionalCredits = Math.floor(credits * ratio)
   *   - 반올림: Math.floor 고정 (소수점 버림으로 차감 ↓ — 사용자 우호)
   *   - refundedAmount > payment.amount: BadRequestException (validation)
   *   - payment.amount === 0: BadRequestException (free 결제 환불 무의미)
   *
   * 분기:
   *   정상 환수 (잔액 ≥ proportionalCredits): actualDeducted=proportionalCredits, deficitCredits=0
   *   deficit 환수 (잔액 < proportionalCredits): actualDeducted=잔액, deficitCredits=proportionalCredits-잔액
   */
  async refundPaymentAtomically(input: {
    paymentId: string
    authorId: string
    credits: number
    refundedAmount: number
    reason: string
    source: 'webhook' | 'manual'
  }): Promise<{
    actualDeducted: number
    deficitCredits: number
    proportionalCredits: number
    isPartial: boolean
  }> {
    const { paymentId, authorId, credits, refundedAmount, reason, source } = input

    return await this.prisma.$transaction(async (tx) => {
      // 1. Payment 조회 — 원래 결제 금액 확인 (부분 환불 비율 계산용)
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: { amount: true, status: true },
      })
      if (!payment) {
        throw new Error(`Payment not found: ${paymentId}`)
      }

      // 2. validation — refundedAmount/payment.amount 정합
      if (payment.amount <= 0) {
        throw new Error(`환불 불가 — payment.amount=${payment.amount} (free 결제 또는 비정상 데이터)`)
      }
      if (refundedAmount <= 0) {
        throw new Error(`환불 금액은 양수여야 합니다: ${refundedAmount}`)
      }
      if (refundedAmount > payment.amount) {
        throw new Error(
          `환불 금액(${refundedAmount})이 결제 금액(${payment.amount})을 초과할 수 없습니다`,
        )
      }

      // 3-4. 비율 + 비례 크레딧 계산 (PAY-P2-1)
      const ratio = refundedAmount / payment.amount
      const isPartial = ratio < 1.0
      const proportionalCredits = isPartial ? Math.floor(credits * ratio) : credits

      // 5. Payment 상태 — 전액 환불은 'refunded', 부분 환불은 'partial_refunded'
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: isPartial ? 'partial_refunded' : 'refunded' },
      })

      // 6. 현재 Author 잔액 조회 (race 차단 — 동일 $transaction 내 일관성 보장)
      const author = await tx.author.findUnique({
        where: { id: authorId },
        select: { credits: true },
      })
      if (!author) {
        throw new Error(`Author not found: ${authorId}`)
      }

      // 7. actualDeducted / deficitCredits 계산 — 음수 잔액 절대 차단
      const currentBalance = author.credits
      const actualDeducted = Math.min(currentBalance, proportionalCredits)
      const deficitCredits = Math.max(0, proportionalCredits - currentBalance)

      // 8. Author.credits decrement (0 fix 보장)
      if (actualDeducted > 0) {
        await tx.author.update({
          where: { id: authorId },
          data: { credits: { decrement: actualDeducted } },
        })
      }

      // 9. CreditLog 음수 박제 (대칭 — completePaymentAtomically의 양수와 정합)
      // 0 차감 시도도 박제 (deficit 추적용)
      await tx.creditLog.create({
        data: {
          authorId,
          amount: -actualDeducted,
          reason: `refund_${paymentId}_${source}${isPartial ? '_partial' : ''}`,
        },
      })

      // 10. RefundLog 박제
      await tx.refundLog.create({
        data: {
          paymentId,
          amount: refundedAmount,
          credits: actualDeducted,
          deficitCredits,
          reason,
          source,
        },
      })

      return { actualDeducted, deficitCredits, proportionalCredits, isPartial }
    })
  }
}
