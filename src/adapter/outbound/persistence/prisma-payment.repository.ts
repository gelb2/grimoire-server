import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { PaymentRepositoryPort, PaymentRecord } from '@domain/port/outbound/payment-repository.port'
import {
  computeChargeLedgerEntries,
  computeRefundLedgerEntries,
  SourceBalances,
} from '@domain/policy/credit-consumption-policy'
import { CreditSource } from '@domain/model/credit-source'

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

  /**
   * @deprecated CC-2a (2026-05-20) — 구 `Author.credits` Int + `CreditLog` 경로.
   * 충전 success 는 `completePaymentWithPoints`(신 포인트 원장)를 사용한다.
   * CC-2b 완결 후 일괄 제거 예정 — 현재 호출처 0건 (계획 §3 C3c).
   */
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

  /**
   * 결제 완료 + 충전 포인트 적립 원자 처리 (CC-2a 신설 — 案 1 트랜잭션 통합).
   *
   * 진단 정본: `reports/CREDIT_CORE_DIAGNOSIS.md` §1-A(T3) + §6-2(settleDeficit 완결).
   * port 시그니처 정본: `payment-repository.port.ts` `completePaymentWithPoints`.
   *
   * CLAUDE.md §9 결제 원자성 — 아래 전부를 단일 `$transaction`으로 묶는다
   * ("돈은 냈는데 포인트 없음"은 §0·§9상 절대 불가):
   *   ① authors row FOR UPDATE 잠금 — 동시 차감/적립 직렬화 (`prisma-credit-ledger.repository` 패턴)
   *   ② Payment status='completed' + completedAt
   *   ③ deficit 우선 상계 (settledDeficit > 0) — `CreditLedger` type='deficit_settle' row
   *      + `Author.deficitPoints` = remainingDeficit (§8-4 — 충전 즉시 최우선 외상 상계)
   *   ④ 남은 충전 적립 (remainingCharge > 0) — `CreditLedger` source='charged' type='earn' row
   *      + `Author.pointsCharged` = newChargedCache
   *
   * 금액 계산은 도메인 순수 함수 `computeChargeLedgerEntries`에 위임 (案 1 로직 중복 0건).
   * 구 `CreditLog` 박제 0건 — CC-1이 적립을 `CreditLedger`로 완전 이행 (계획 S0 C1b→C3d).
   *
   * balanceAfter 회계: earn row 는 적립 후 4 출처 총 잔액, deficit_settle row 는 잔액 변동
   * 없으므로(외상 감소만) 현 charged 캐시 — `prisma-credit-ledger.repository`의 회계와 동일.
   */
  async completePaymentWithPoints(
    paymentId: string,
    authorId: string,
    totalPoints: number,
    productId: string,
    relatedId?: string,
  ): Promise<{ settledDeficit: number; chargedPoints: number }> {
    if (!Number.isInteger(totalPoints) || totalPoints <= 0) {
      throw new Error(`충전 포인트는 양의 정수여야 합니다: ${totalPoints}`)
    }

    return this.prisma.$transaction(async (tx) => {
      // ① authors row FOR UPDATE — 같은 작가 동시 차감/적립 직렬화
      const [locked] = await tx.$queryRawUnsafe<
        {
          points_free: number
          points_subscription: number
          points_gift: number
          points_charged: number
          deficit_points: number
        }[]
      >(
        'SELECT points_free, points_subscription, points_gift, points_charged, deficit_points FROM authors WHERE id = $1 FOR UPDATE',
        authorId,
      )
      if (!locked) throw new Error('작가를 찾을 수 없습니다')

      // ② Payment 완료 처리
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'completed', completedAt: new Date() },
      })

      // 충전 적립 ledger 계획 — deficit 우선 상계 + 남은 충전액 (도메인 순수 함수)
      const currentDeficit = Number(locked.deficit_points)
      const currentCharged = Number(locked.points_charged)
      const { settledDeficit, remainingCharge, remainingDeficit, newChargedCache } =
        computeChargeLedgerEntries(totalPoints, currentDeficit, currentCharged)

      // ③ deficit 우선 상계 — 외상이 있을 때만
      if (settledDeficit > 0) {
        await tx.author.update({
          where: { id: authorId },
          data: { deficitPoints: remainingDeficit },
        })
        await tx.creditLedger.create({
          data: {
            authorId,
            source: 'charged',
            type: 'deficit_settle',
            amount: -settledDeficit,
            // deficit_settle 은 잔액 변동 없음 (외상 감소만) — 현 charged 캐시
            balanceAfter: currentCharged,
            reason: 'deficit_settle_on_charge',
            relatedId: relatedId ?? paymentId,
          },
        })
      }

      // ④ 남은 충전액 적립 — 외상이 충전액 전부를 잠식한 극단 케이스면 0 → earn 생략
      if (remainingCharge > 0) {
        const newTotal =
          Number(locked.points_free) +
          Number(locked.points_subscription) +
          Number(locked.points_gift) +
          newChargedCache
        await tx.author.update({
          where: { id: authorId },
          data: { pointsCharged: newChargedCache },
        })
        await tx.creditLedger.create({
          data: {
            authorId,
            source: 'charged',
            type: 'earn',
            amount: remainingCharge,
            balanceAfter: newTotal,
            reason: `purchase_${productId}`,
            relatedId: relatedId ?? paymentId,
          },
        })
      }

      return { settledDeficit, chargedPoints: remainingCharge }
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
   * @deprecated CC-2b (2026-05-20) — 구 `Author.credits` Int + `CreditLog` 경로.
   * 환불 cancel 경로는 `refundPaymentWithPoints`(신 포인트 원장 + 이중 외상 통합) 사용.
   * 본 메서드는 회귀 안전망으로 잔존 — CC-3/CC-4 후속에서 일괄 제거.
   *
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

      // 6. 현재 Author 잔액 조회 — findUniqueOrThrow (race 시 author 미존재 케이스도 throw로 명시)
      // PAY-P3-A 정본: shared-contracts §22 PaymentRaceCondition (CAS 패턴 강화)
      const author = await tx.author.findUniqueOrThrow({
        where: { id: authorId },
        select: { credits: true },
      })

      // 7. actualDeducted / deficitCredits 계산 — 음수 잔액 절대 차단
      const currentBalance = author.credits
      const actualDeducted = Math.min(currentBalance, proportionalCredits)
      const deficitCredits = Math.max(0, proportionalCredits - currentBalance)

      // 8. Author.credits decrement (0 fix 보장) — PAY-P3-A CAS 패턴 적용
      // updateMany WHERE credits >= actualDeducted (Postgres atomic check-and-set)
      // 동시 트랜잭션이 author.credits를 변경한 경우 0 row 갱신 → throw CAS_MISMATCH
      // 호출자(refund-payment.usecase + payment.usecase)는 catch → webhookEventRepo 'failed' + DLQ enqueue
      if (actualDeducted > 0) {
        const updateResult = await tx.author.updateMany({
          where: {
            id: authorId,
            credits: { gte: actualDeducted },
          },
          data: { credits: { decrement: actualDeducted } },
        })
        if (updateResult.count === 0) {
          // race window 검출 — 다른 트랜잭션이 author.credits를 변경하여 CAS 조건 미충족
          // PAY-P2-2 DLQ retry 위임 (WebhookRetryJob @Cron 5분이 재처리)
          throw new Error(
            `CAS_MISMATCH — race condition detected on author.credits (authorId=${authorId}, expected_min=${actualDeducted})`,
          )
        }
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

  /**
   * 환불 신 경로 — 案 R1 (CC-2b — 진단 §1-C). CC-2a `completePaymentWithPoints` 와 대칭.
   *
   * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §1-C
   *       .claude/state/sprint-cc2b-gift-refund-wiring-plan-draft.md §4-2
   *
   * CLAUDE.md §9 결제 원자성 — 아래 전부를 단일 `$transaction` 으로 묶는다:
   *   1. authors row FOR UPDATE — 같은 작가 동시 차감/환수 직렬화
   *   2. Payment 조회 + validation(refundedAmount > 0, ≤ payment.amount) + 비례 계산(PAY-P2-1)
   *   3. Payment status — 전액 'refunded' / 부분 'partial_refunded'
   *   4. `computeRefundLedgerEntries` 로 4 출처 환수액 + 외상 부족분 계산
   *      (환수 우선순위: charged → gift → subscription → free)
   *   5. 출처별 PAY-P3-A CAS race 차단 (`updateMany WHERE 컬럼>=환수액 decrement`)
   *      + `CreditLedger source=출처 type='spend'` row 박제
   *   6. **이중 외상 통합** — 부족분 `Author.deficitPoints += deficitIncurred`
   *      + `CreditLedger type='deficit_incur'` row(reason=`refund_deficit:..`).
   *      외상 잔액 정본 = `Author.deficitPoints` (단일). 다음 충전 시 CC-2a 가 자동 회수.
   *   7. `RefundLog` 박제 — `credits` = 실 환수 pt, `deficitCredits` = 외상 발생 pt
   *      (MEDIUM-4 — 의미 재해석. 컬럼 물리 rename 은 CC-4 위임).
   */
  async refundPaymentWithPoints(input: {
    paymentId: string
    authorId: string
    refundPt: number
    refundedAmount: number
    reason: string
    source: 'webhook' | 'manual'
  }): Promise<{
    actualRefunded: number
    deficitIncurred: number
    proportionalPt: number
    isPartial: boolean
  }> {
    const { paymentId, authorId, refundPt, refundedAmount, reason, source } = input

    if (!Number.isInteger(refundPt) || refundPt < 0) {
      throw new Error(`환수 포인트는 0 이상 정수여야 합니다: ${refundPt}`)
    }
    if (refundedAmount <= 0) {
      throw new Error(`환불 금액은 양수여야 합니다: ${refundedAmount}`)
    }

    return await this.prisma.$transaction(async (tx) => {
      // 1. authors row FOR UPDATE — 동시 차감/환수 직렬화 (`prisma-credit-ledger.repository` 패턴)
      const [locked] = await tx.$queryRawUnsafe<
        {
          points_free: number
          points_subscription: number
          points_gift: number
          points_charged: number
          deficit_points: number
        }[]
      >(
        'SELECT points_free, points_subscription, points_gift, points_charged, deficit_points FROM authors WHERE id = $1 FOR UPDATE',
        authorId,
      )
      if (!locked) throw new Error('작가를 찾을 수 없습니다')

      // 2. Payment 조회 + validation + 비례 계산 (PAY-P2-1)
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: { amount: true, credits: true, status: true },
      })
      if (!payment) {
        throw new Error(`Payment not found: ${paymentId}`)
      }
      if (payment.amount <= 0) {
        throw new Error(
          `환불 불가 — payment.amount=${payment.amount} (free 결제 또는 비정상 데이터)`,
        )
      }
      if (refundedAmount > payment.amount) {
        throw new Error(
          `환불 금액(${refundedAmount})이 결제 금액(${payment.amount})을 초과할 수 없습니다`,
        )
      }

      const ratio = refundedAmount / payment.amount
      const isPartial = ratio < 1.0
      // payment.credits = MEDIUM-4 의미 재해석 후 충전 총 pt (CC-2a)
      // 비례 환수 pt = refundPt 입력값(refund-payment.usecase 가 payment.credits × ratio 또는 입력 그대로)
      // 본 메서드 내부에선 입력 refundPt 를 비례 계산에 사용 (호출자가 payment.credits 전달 시 비례 적용)
      const proportionalPt = isPartial ? Math.floor(refundPt * ratio) : refundPt

      // 3. Payment status — 전액 'refunded' / 부분 'partial_refunded'
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: isPartial ? 'partial_refunded' : 'refunded' },
      })

      // 4. 4 출처 환수 계획 — charged → gift → subscription → free 우선순위
      const balances: SourceBalances = {
        free: Number(locked.points_free),
        subscription: Number(locked.points_subscription),
        gift: Number(locked.points_gift),
        charged: Number(locked.points_charged),
      }
      const totalBefore =
        balances.free + balances.subscription + balances.gift + balances.charged
      const { recoveredBySource, totalRecovered, deficitIncurred } =
        computeRefundLedgerEntries(proportionalPt, balances)

      const balanceAfter = totalBefore - totalRecovered

      // 5. 출처별 환수 — PAY-P3-A CAS race 차단 (`updateMany WHERE 컬럼>=환수액 decrement`)
      for (const source of [
        'charged',
        'gift',
        'subscription',
        'free',
      ] as CreditSource[]) {
        const recovered = recoveredBySource[source]
        if (recovered > 0) {
          const column = sourceColumnSnake(source)
          // CAS — 동시 트랜잭션이 잔액을 변경한 경우 0 row → throw (DLQ retry 위임)
          const updateResult = await tx.$executeRawUnsafe(
            `UPDATE authors SET ${column} = ${column} - $1 WHERE id = $2 AND ${column} >= $1`,
            recovered,
            authorId,
          )
          if (updateResult === 0) {
            throw new Error(
              `CAS_MISMATCH — race condition detected on author.${column} ` +
                `(authorId=${authorId}, source=${source}, expected_min=${recovered})`,
            )
          }
          await tx.creditLedger.create({
            data: {
              authorId,
              source,
              type: 'spend',
              amount: -recovered,
              balanceAfter,
              reason: `refund_${paymentId}_${source}${isPartial ? '_partial' : ''}`,
              relatedId: paymentId,
            },
          })
        }
      }

      // 6. 이중 외상 통합 — 부족분 Author.deficitPoints 가산 + deficit_incur ledger
      if (deficitIncurred > 0) {
        await tx.author.update({
          where: { id: authorId },
          data: {
            deficitPoints: Number(locked.deficit_points) + deficitIncurred,
          },
        })
        await tx.creditLedger.create({
          data: {
            authorId,
            // deficit 발생 — 환불은 charged 환수 우선이므로 charged 출처로 귀속
            source: 'charged',
            type: 'deficit_incur',
            amount: -deficitIncurred,
            balanceAfter,
            reason: `refund_deficit:${paymentId}${isPartial ? '_partial' : ''}`,
            relatedId: paymentId,
          },
        })
      }

      // 7. RefundLog 박제 — MEDIUM-4 의미 재해석
      //    credits = 실 환수 pt(totalRecovered) / deficitCredits = 외상 발생 pt(deficitIncurred)
      //    (컬럼 물리 rename 은 CC-4 위임, 본 sprint 는 코드·문서 의미 재해석만)
      await tx.refundLog.create({
        data: {
          paymentId,
          amount: refundedAmount,
          credits: totalRecovered,
          deficitCredits: deficitIncurred,
          reason,
          source,
        },
      })

      return {
        actualRefunded: totalRecovered,
        deficitIncurred,
        proportionalPt,
        isPartial,
      }
    })
  }
}

/** CreditSource → raw query snake_case 컬럼명 (prisma-credit-ledger.repository 와 동일) */
function sourceColumnSnake(
  source: CreditSource,
): 'points_free' | 'points_subscription' | 'points_gift' | 'points_charged' {
  switch (source) {
    case 'free':
      return 'points_free'
    case 'subscription':
      return 'points_subscription'
    case 'gift':
      return 'points_gift'
    case 'charged':
      return 'points_charged'
  }
}
