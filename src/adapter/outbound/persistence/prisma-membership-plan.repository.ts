import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import {
  MembershipPlanPort,
  MembershipPlanState,
} from '@domain/port/outbound/membership-plan.port'
import {
  MembershipTier,
  normalizeMembershipTier,
  monthlyPoolFor,
} from '@domain/model/membership-tier'

/**
 * 크레딧 개편 I Phase (2026-05-17) — MembershipPlan 구독 등급 + 월 풀 Prisma 어댑터.
 *
 * 정본: .claude/shared-contracts.md §30 CreditOverhaul
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §5, §8-6
 *
 * 4-C 구조 — 월간 리셋은 $transaction:
 *   1. 기존 구독풀 CreditLedger 만료(type='expire') — 잔여 풀 음수 차감
 *   2. 신규 풀 CreditLedger 적립(type='earn', source='subscription', expiresAt=다음 리셋)
 *   3. MembershipPlan.poolBalance/poolResetAt 갱신
 *   4. Author.pointsSubscription 캐시 동기 (이번 달 풀로 재설정 — 이월 금지)
 */
@Injectable()
export class PrismaMembershipPlanRepository implements MembershipPlanPort {
  constructor(private readonly prisma: PrismaService) {}

  async getPlan(authorId: string): Promise<MembershipPlanState | null> {
    const row = await this.prisma.membershipPlan.findFirst({
      where: { authorId, status: 'active' },
      orderBy: { startedAt: 'desc' },
    })
    return row ? toDomain(row) : null
  }

  async resetMonthlyPool(authorId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const plan = await tx.membershipPlan.findFirst({
        where: { authorId, status: 'active' },
        orderBy: { startedAt: 'desc' },
      })
      if (!plan) throw new Error('활성 멤버십을 찾을 수 없습니다')

      const tier = normalizeMembershipTier(plan.tier)
      const newPool = monthlyPoolFor(tier)
      const nextResetAt = nextMonthStart(now)

      // 1. authors FOR UPDATE — 캐시 동기 직렬화
      const [locked] = await tx.$queryRawUnsafe<
        { points_subscription: number }[]
      >(
        'SELECT points_subscription FROM authors WHERE id = $1 FOR UPDATE',
        authorId,
      )
      if (!locked) throw new Error('작가를 찾을 수 없습니다')

      const prevSubscriptionCache = Number(locked.points_subscription)

      // 2. 기존 구독풀 잔여분 만료 박제 (이월 금지 — §8-8 #2)
      if (prevSubscriptionCache > 0) {
        await tx.creditLedger.create({
          data: {
            authorId,
            source: 'subscription',
            type: 'expire',
            amount: -prevSubscriptionCache,
            balanceAfter: 0, // 만료 후 구독풀 출처 잔액 0 (직후 신규 적립)
            reason: 'monthly_pool_expire',
          },
        })
      }

      // 3. 신규 풀 적립 박제 (free 면 newPool=0 → ledger 생략)
      if (newPool > 0) {
        await tx.creditLedger.create({
          data: {
            authorId,
            source: 'subscription',
            type: 'earn',
            amount: newPool,
            balanceAfter: newPool, // 구독풀 출처 한정 잔액
            expiresAt: nextResetAt,
            reason: 'monthly_pool_reset',
          },
        })
      }

      // 4. MembershipPlan + Author 캐시 갱신 (이번 달 풀로 재설정 — 이월 금지)
      await tx.membershipPlan.update({
        where: { id: plan.id },
        data: {
          monthlyPoolPoints: newPool,
          poolBalance: newPool,
          poolResetAt: nextResetAt,
        },
      })
      await tx.author.update({
        where: { id: authorId },
        data: { pointsSubscription: newPool },
      })
    })
  }

  async findPlansToReset(now: Date): Promise<MembershipPlanState[]> {
    const rows = await this.prisma.membershipPlan.findMany({
      where: {
        status: 'active',
        poolResetAt: { lte: now },
        tier: { in: ['pro', 'premium'] },
      },
    })
    return rows.map(toDomain)
  }

  async changeTier(
    authorId: string,
    tier: MembershipTier,
    now: Date,
  ): Promise<MembershipPlanState> {
    const newPool = monthlyPoolFor(tier)
    const nextResetAt = nextMonthStart(now)

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.membershipPlan.findFirst({
        where: { authorId, status: 'active' },
        orderBy: { startedAt: 'desc' },
      })
      if (existing) {
        return tx.membershipPlan.update({
          where: { id: existing.id },
          data: {
            tier,
            monthlyPoolPoints: newPool,
            poolBalance: newPool,
            poolResetAt: nextResetAt,
          },
        })
      }
      // 멤버십 row 가 없는 작가 (마이그레이션 누락 방어) — 신규 생성
      return tx.membershipPlan.create({
        data: {
          authorId,
          tier,
          monthlyPoolPoints: newPool,
          poolBalance: newPool,
          poolResetAt: nextResetAt,
          status: 'active',
        },
      })
    })
    return toDomain(updated)
  }
}

/** 다음 달 1일 0시 (월간 리셋 기준) */
function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0))
}

/** Prisma row → 도메인 MembershipPlanState */
function toDomain(row: {
  id: string
  authorId: string
  tier: string
  monthlyPoolPoints: number
  poolBalance: number
  poolResetAt: Date
  startedAt: Date
  expiresAt: Date | null
  polarSubscriptionId: string | null
  status: string
}): MembershipPlanState {
  return {
    id: row.id,
    authorId: row.authorId,
    tier: normalizeMembershipTier(row.tier),
    monthlyPoolPoints: row.monthlyPoolPoints,
    poolBalance: row.poolBalance,
    poolResetAt: row.poolResetAt,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    polarSubscriptionId: row.polarSubscriptionId,
    status:
      row.status === 'active' || row.status === 'expired' || row.status === 'cancelled'
        ? row.status
        : 'active',
  }
}
