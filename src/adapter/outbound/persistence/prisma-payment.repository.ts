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
   * 환불 원자 처리 — payment.status='refunded' + Author.credits decrement(0 fix) + CreditLog(음수) + RefundLog 박제
   * (Sprint PAY-P1-1, 2026-05-03 — 정본: `.claude/shared-contracts.md` §13)
   *
   * $transaction 내부 처리 순서:
   *   1. tx.payment.update — status='refunded'
   *   2. tx.author.findUnique — 현재 잔액 조회
   *   3. actualDeducted = Math.min(currentBalance, credits) (0 fix 보장)
   *   4. deficitCredits = Math.max(0, credits - currentBalance)
   *   5. tx.author.update — credits decrement(actualDeducted)
   *   6. tx.creditLog.create — amount=-actualDeducted (음수, 대칭)
   *   7. tx.refundLog.create — paymentId/amount/credits/deficitCredits/reason/source
   *
   * 정상 환수 (Author.credits >= credits): actualDeducted=credits, deficitCredits=0
   * deficit 환수 (Author.credits < credits): actualDeducted=잔액, deficitCredits=credits-잔액
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
  }> {
    const { paymentId, authorId, credits, refundedAmount, reason, source } = input

    return await this.prisma.$transaction(async (tx) => {
      // 1. Payment 상태 → refunded
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'refunded' },
      })

      // 2. 현재 Author 잔액 조회 (race 차단 — 동일 $transaction 내 일관성 보장)
      const author = await tx.author.findUnique({
        where: { id: authorId },
        select: { credits: true },
      })
      if (!author) {
        throw new Error(`Author not found: ${authorId}`)
      }

      // 3. actualDeducted / deficitCredits 계산 — 음수 잔액 절대 차단
      const currentBalance = author.credits
      const actualDeducted = Math.min(currentBalance, credits)
      const deficitCredits = Math.max(0, credits - currentBalance)

      // 4. Author.credits decrement (0 fix 보장)
      await tx.author.update({
        where: { id: authorId },
        data: { credits: { decrement: actualDeducted } },
      })

      // 5. CreditLog 음수 박제 (대칭 — completePaymentAtomically의 양수와 정합)
      await tx.creditLog.create({
        data: {
          authorId,
          amount: -actualDeducted,
          reason: `refund_${paymentId}_${source}`,
        },
      })

      // 6. RefundLog 박제
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

      return { actualDeducted, deficitCredits }
    })
  }
}
