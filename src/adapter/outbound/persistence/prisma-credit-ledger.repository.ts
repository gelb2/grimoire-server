import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import {
  CreditLedgerPort,
  CreditLedgerEntry,
  CreditBalance,
  SpendResult,
  EarnInput,
  SpendInput,
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
