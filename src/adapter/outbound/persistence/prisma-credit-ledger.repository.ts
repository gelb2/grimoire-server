import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import {
  CreditLedgerPort,
  CreditLedgerEntry,
  CreditBalance,
  SpendResult,
  EarnInput,
  SpendInput,
  TransferResult,
} from '@domain/port/outbound/credit-ledger.port'
import {
  CreditSource,
  CreditLedgerType,
  isCreditSource,
  isCreditLedgerType,
} from '@domain/model/credit-source'
import {
  planConsumption,
  settleDeficitOnCharge,
  SourceBalances,
} from '@domain/policy/credit-consumption-policy'

/**
 * 크레딧 개편 I Phase (2026-05-17) — CreditLedger 입출금 원장 Prisma 어댑터.
 *
 * 정본: .claude/shared-contracts.md §30 CreditOverhaul
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §5, §8-1
 *
 * 1-C 하이브리드 — 모든 적립/소진을 $transaction 으로:
 *   1. authors row 를 FOR UPDATE 잠금 (동시 차감 직렬화 — prisma-credit.repository 패턴 차용)
 *   2. CreditLedger insert (출처별, 부호 有)
 *   3. Author 4 필드 캐시 동기 갱신
 *   4. (소진 시 부족분) deficit_incur ledger + Author.deficitPoints 가산
 *
 * 잔액 캐시(Author 4 필드)와 원장(CreditLedger) 정합은 별도 cron 으로 검증
 * (PAY-P0-2 ReconciliationCheckpoint 패턴 — I Phase 후속).
 */
@Injectable()
export class PrismaCreditLedgerRepository implements CreditLedgerPort {
  constructor(private readonly prisma: PrismaService) {}

  async earn(input: EarnInput): Promise<CreditLedgerEntry> {
    const { authorId, source, amount, reason, expiresAt, relatedId } = input
    if (amount <= 0) {
      throw new Error(`적립액은 양수여야 합니다: ${amount}`)
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // FOR UPDATE — 같은 작가 row 동시 변경 직렬화
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

      // 해당 출처 캐시 가산
      const column = sourceColumn(source)
      const newSourceBalance = Number(locked[snakeColumn(source)]) + amount
      const newTotal =
        Number(locked.points_free) +
        Number(locked.points_subscription) +
        Number(locked.points_gift) +
        Number(locked.points_charged) +
        amount

      await tx.author.update({
        where: { id: authorId },
        data: { [column]: newSourceBalance },
      })

      const ledger = await tx.creditLedger.create({
        data: {
          authorId,
          source,
          type: 'earn',
          amount,
          balanceAfter: newTotal,
          expiresAt: expiresAt ?? null,
          reason,
          relatedId: relatedId ?? null,
        },
      })
      return ledger
    })

    return toDomain(result)
  }

  async spend(input: SpendInput): Promise<SpendResult> {
    const { authorId, amount, reason, relatedId } = input
    if (amount <= 0) {
      throw new Error(`소진액은 양수여야 합니다: ${amount}`)
    }

    return this.prisma.$transaction(async (tx) => {
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

      const balances: SourceBalances = {
        free: Number(locked.points_free),
        subscription: Number(locked.points_subscription),
        gift: Number(locked.points_gift),
        charged: Number(locked.points_charged),
      }

      // 소진 우선순위 계산 (도메인 정책 — §8-2)
      const plan = planConsumption(balances, amount)

      const totalBefore =
        balances.free + balances.subscription + balances.gift + balances.charged
      // 4 출처 차감 후 잔액 (deficit 발생 시 0 floor)
      const balanceAfter = totalBefore - plan.totalSpent

      // 출처별 캐시 차감 — 차감액이 있는 출처만 update
      for (const source of [
        'free',
        'subscription',
        'gift',
        'charged',
      ] as CreditSource[]) {
        const spent = plan.spentBySource[source]
        if (spent > 0) {
          await tx.author.update({
            where: { id: authorId },
            data: {
              [sourceColumn(source)]: balances[source] - spent,
            },
          })
          // 출처별 spend ledger 박제 (회계 분리 — 어느 출처 얼마 소진)
          await tx.creditLedger.create({
            data: {
              authorId,
              source,
              type: 'spend',
              amount: -spent,
              balanceAfter,
              reason,
              relatedId: relatedId ?? null,
            },
          })
        }
      }

      // 잔액 부족분 = deficit (사후 차감 — §8-4)
      if (plan.deficitIncurred > 0) {
        await tx.author.update({
          where: { id: authorId },
          data: {
            deficitPoints: Number(locked.deficit_points) + plan.deficitIncurred,
          },
        })
        await tx.creditLedger.create({
          data: {
            authorId,
            // deficit 발생 — 소진 우선순위상 마지막 출처(charged)로 귀속 회계
            source: 'charged',
            type: 'deficit_incur',
            amount: -plan.deficitIncurred,
            balanceAfter,
            reason: `deficit:${reason}`,
            relatedId: relatedId ?? null,
          },
        })
      }

      return {
        spentBySource: plan.spentBySource,
        deficitIncurred: plan.deficitIncurred,
        balanceAfter,
      }
    })
  }

  async getBalance(authorId: string): Promise<CreditBalance> {
    const author = await this.prisma.author.findUnique({
      where: { id: authorId },
      select: {
        pointsFree: true,
        pointsSubscription: true,
        pointsGift: true,
        pointsCharged: true,
        deficitPoints: true,
      },
    })
    if (!author) throw new Error('작가를 찾을 수 없습니다')

    const total =
      author.pointsFree +
      author.pointsSubscription +
      author.pointsGift +
      author.pointsCharged
    return {
      free: author.pointsFree,
      subscription: author.pointsSubscription,
      gift: author.pointsGift,
      charged: author.pointsCharged,
      total,
      deficit: author.deficitPoints,
      available: total - author.deficitPoints,
    }
  }

  async settleDeficit(authorId: string, fromAmount: number): Promise<number> {
    if (fromAmount <= 0) {
      throw new Error(`상계 재원은 양수여야 합니다: ${fromAmount}`)
    }

    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRawUnsafe<
        { deficit_points: number; points_charged: number }[]
      >(
        'SELECT deficit_points, points_charged FROM authors WHERE id = $1 FOR UPDATE',
        authorId,
      )
      if (!locked) throw new Error('작가를 찾을 수 없습니다')

      const currentDeficit = Number(locked.deficit_points)
      if (currentDeficit <= 0) return 0

      const { settledDeficit, remainingDeficit } = settleDeficitOnCharge(
        fromAmount,
        currentDeficit,
      )
      if (settledDeficit <= 0) return 0

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
          // deficit_settle 은 잔액 변동 없음 (외상 감소만) — balanceAfter 는 현 charged 캐시
          balanceAfter: Number(locked.points_charged),
          reason: 'deficit_settle_on_charge',
        },
      })
      return settledDeficit
    })
  }

  async findByAuthor(
    authorId: string,
    limit: number,
  ): Promise<CreditLedgerEntry[]> {
    const rows = await this.prisma.creditLedger.findMany({
      where: { authorId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return rows.map(toDomain)
  }

  /**
   * 응원받는 작가 랭킹 — CC-3 (HIGH-3).
   *
   * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §5-B / ADR-014.
   *
   * `source='gift', type='earn'` 적립만 groupBy(authorId) → 누적 받은 선물 pt 합 내림차순.
   * S0c 동등성 게이트 — 구 `prisma-credit.repository.getGiftRanking` 와 동일 반환 타입
   * `{authorId, totalGifted}[]` + 동일 limit/정렬 의미.
   */
  async getGiftRanking(
    limit: number,
  ): Promise<{ authorId: string; totalGifted: number }[]> {
    const rows = await this.prisma.creditLedger.groupBy({
      by: ['authorId'],
      where: { source: 'gift', type: 'earn' },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: limit,
    })
    return rows.map((r) => ({
      authorId: r.authorId,
      totalGifted: r._sum.amount ?? 0,
    }))
  }

  /**
   * 응원 선물 — 案 G1 단일 `$transaction` (CC-2b — 진단 §1-B).
   *
   * sender(독자) ↔ receiver(작가) 양측 작가 1 트랜잭션 이동. CLAUDE.md §9 결제 원자성:
   * 한쪽만 반영되는 사고는 절대 불가 → 양측 lock + 양측 ledger row + 양측 캐시를 1 tx.
   *
   * 트랜잭션 본문:
   *   1. 자기 선물(senderId===receiverId) 차단 (사전 검증)
   *   2. 데드락 방지 lock 순서 — `senderId<receiverId` 비교로 작은 id 먼저 FOR UPDATE
   *      (`prisma-credit.repository.giftTransfer` 와 동일 패턴 — 두 선물 교차 시에도 안전)
   *   3. sender `planConsumption`(무료→구독→선물→충전) 으로 4 출처 차감 계산.
   *      `deficitIncurred>0` 면 throw — **외상 선물 불가** (`spend` 와 다른 점).
   *   4. sender 출처별 `CreditLedger spend` row 박제 + Author 4 캐시 차감.
   *      balanceAfter = sender 4 출처 합 - amount.
   *   5. receiver `Author.pointsGift` += amount + `CreditLedger source='gift' earn` row 박제.
   *      balanceAfter = receiver 4 출처 합 + amount.
   *
   * @returns { senderSpentBySource: 4 출처 차감액(합=amount), receiverGiftBalance: 갱신 후 pointsGift }
   */
  async transfer(
    senderId: string,
    receiverId: string,
    amount: number,
    relatedId?: string,
  ): Promise<TransferResult> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`선물 금액은 양의 정수여야 합니다: ${amount}`)
    }
    if (senderId === receiverId) {
      throw new Error('자기 자신에게 선물할 수 없습니다')
    }

    return this.prisma.$transaction(async (tx) => {
      // 데드락 방지 lock 순서 — `prisma-credit.repository.giftTransfer` 와 동일 패턴.
      // 항상 작은 id 먼저 FOR UPDATE → 두 선물이 교차 호출돼도 데드락 불가.
      const [firstId, secondId] =
        senderId < receiverId ? [senderId, receiverId] : [receiverId, senderId]
      const rows = await tx.$queryRawUnsafe<
        {
          id: string
          points_free: number
          points_subscription: number
          points_gift: number
          points_charged: number
          deficit_points: number
        }[]
      >(
        'SELECT id, points_free, points_subscription, points_gift, points_charged, deficit_points FROM authors WHERE id IN ($1, $2) ORDER BY id FOR UPDATE',
        firstId,
        secondId,
      )
      const senderRow = rows.find((r) => r.id === senderId)
      const receiverRow = rows.find((r) => r.id === receiverId)
      if (!senderRow || !receiverRow) {
        throw new Error('유저를 찾을 수 없습니다')
      }

      const senderBalances: SourceBalances = {
        free: Number(senderRow.points_free),
        subscription: Number(senderRow.points_subscription),
        gift: Number(senderRow.points_gift),
        charged: Number(senderRow.points_charged),
      }

      // sender 4 출처 차감 계획 — 소진 우선순위(무료→구독→선물→충전)
      const plan = planConsumption(senderBalances, amount)
      if (plan.deficitIncurred > 0) {
        // 외상 선물 불가 — 잔액이 부족하면 transfer 자체를 throw (채팅 spend 와 다름)
        throw new Error('포인트가 부족합니다')
      }

      const senderTotalBefore =
        senderBalances.free +
        senderBalances.subscription +
        senderBalances.gift +
        senderBalances.charged
      const senderBalanceAfter = senderTotalBefore - amount

      // sender 측 — 출처별 차감 + 출처별 spend ledger
      for (const source of [
        'free',
        'subscription',
        'gift',
        'charged',
      ] as CreditSource[]) {
        const spent = plan.spentBySource[source]
        if (spent > 0) {
          await tx.author.update({
            where: { id: senderId },
            data: {
              [sourceColumn(source)]: senderBalances[source] - spent,
            },
          })
          await tx.creditLedger.create({
            data: {
              authorId: senderId,
              source,
              type: 'spend',
              amount: -spent,
              balanceAfter: senderBalanceAfter,
              reason: `gift_sent:${receiverId}`,
              relatedId: relatedId ?? null,
            },
          })
        }
      }

      // receiver 측 — pointsGift 가산 + gift earn ledger
      const receiverGiftBefore = Number(receiverRow.points_gift)
      const receiverGiftBalance = receiverGiftBefore + amount
      const receiverTotalAfter =
        Number(receiverRow.points_free) +
        Number(receiverRow.points_subscription) +
        receiverGiftBalance +
        Number(receiverRow.points_charged)
      await tx.author.update({
        where: { id: receiverId },
        data: { pointsGift: receiverGiftBalance },
      })
      await tx.creditLedger.create({
        data: {
          authorId: receiverId,
          source: 'gift',
          type: 'earn',
          amount,
          balanceAfter: receiverTotalAfter,
          reason: `gift_received:${senderId}`,
          relatedId: relatedId ?? null,
        },
      })

      return {
        senderSpentBySource: plan.spentBySource,
        receiverGiftBalance,
      }
    })
  }
}

/** CreditSource → Prisma 모델 camelCase 컬럼명 */
function sourceColumn(source: CreditSource): string {
  switch (source) {
    case 'free':
      return 'pointsFree'
    case 'subscription':
      return 'pointsSubscription'
    case 'gift':
      return 'pointsGift'
    case 'charged':
      return 'pointsCharged'
  }
}

/** CreditSource → raw query snake_case 컬럼명 */
function snakeColumn(
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

/** Prisma row → 도메인 CreditLedgerEntry (source/type enum 정합 검증) */
function toDomain(row: {
  id: string
  authorId: string
  source: string
  type: string
  amount: number
  balanceAfter: number
  expiresAt: Date | null
  reason: string
  relatedId: string | null
  createdAt: Date
}): CreditLedgerEntry {
  const source: CreditSource = isCreditSource(row.source)
    ? row.source
    : 'charged'
  const type: CreditLedgerType = isCreditLedgerType(row.type)
    ? row.type
    : 'earn'
  return {
    id: row.id,
    authorId: row.authorId,
    source,
    type,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    expiresAt: row.expiresAt,
    reason: row.reason,
    relatedId: row.relatedId,
    createdAt: row.createdAt,
  }
}
