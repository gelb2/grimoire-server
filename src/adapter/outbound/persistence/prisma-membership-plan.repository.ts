import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import {
  MembershipPlanPort,
  MembershipPlanState,
  LazyResetResult,
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
    polarSubscriptionId?: string,
  ): Promise<MembershipPlanState> {
    const newPool = monthlyPoolFor(tier)
    const nextResetAt = nextMonthStart(now)

    // CC-5 (PAY-P1-4) — 구독 가입/변경 시 구독 종료 의미를 status 로 표현.
    // free 다운그레이드(해지/revoke) = status='cancelled' / pro·premium = status='active'.
    const newStatus = tier === 'free' ? 'cancelled' : 'active'

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.membershipPlan.findFirst({
        where: { authorId, status: 'active' },
        orderBy: { startedAt: 'desc' },
      })
      // CC-5 — polarSubscriptionId 전달 시만 매핑 갱신 (미전달 = 기존 매핑 보존).
      const subscriptionIdData =
        polarSubscriptionId !== undefined ? { polarSubscriptionId } : {}
      const planRow = existing
        ? await tx.membershipPlan.update({
            where: { id: existing.id },
            data: {
              tier,
              monthlyPoolPoints: newPool,
              poolBalance: newPool,
              poolResetAt: nextResetAt,
              status: newStatus,
              // 구독 유효기간 — pro/premium 은 다음 리셋일까지, free 다운그레이드는 즉시 만료.
              expiresAt: tier === 'free' ? now : nextResetAt,
              ...subscriptionIdData,
            },
          })
        : // 멤버십 row 가 없는 작가 (마이그레이션 누락 방어) — 신규 생성
          await tx.membershipPlan.create({
            data: {
              authorId,
              tier,
              monthlyPoolPoints: newPool,
              poolBalance: newPool,
              poolResetAt: nextResetAt,
              status: newStatus,
              expiresAt: tier === 'free' ? now : nextResetAt,
              ...subscriptionIdData,
            },
          })

      // CC-5 (HIGH-1 案 B, ADR-014 案 B 전환) — `MembershipPlan.tier` 정본.
      // `Author.plan` + `planExpireAt` 는 案 A 미러 — DROP(별도 후속 sprint) 전까지 stale 방지.
      // - free 전환 시 planExpireAt = null (만기 의미 없음)
      // - pro/premium 전환 시 planExpireAt = poolResetAt (다음 풀 리셋 = 미러 정책)
      const newPlanExpireAt = tier === 'free' ? null : nextResetAt
      await tx.author.update({
        where: { id: authorId },
        data: { plan: tier, planExpireAt: newPlanExpireAt },
      })

      return planRow
    })
    return toDomain(updated)
  }

  async checkAndResetExpiredPool(
    authorId: string,
    now: Date,
  ): Promise<LazyResetResult> {
    // 정본: ADR-014 — CRITICAL-1 案 B (cron + lazy 이중 안전망).
    // S Phase draft §8-6 "cron + lazy 이중 안전망" 원안 복원 — I Phase 가 명시 유예한 후속.
    const plan = await this.getPlan(authorId)
    if (!plan) {
      return { reset: false, plan: null }
    }
    // free 또는 non-active 는 no-op — 풀이 없거나 멤버십 종료.
    if (plan.tier === 'free' || plan.status !== 'active') {
      return { reset: false, plan }
    }
    // poolResetAt 미만료 — no-op (현 풀 유효).
    if (plan.poolResetAt.getTime() > now.getTime()) {
      return { reset: false, plan }
    }
    // poolResetAt 만료 — cron 과 동일 메서드 호출 (idempotent — FOR UPDATE 직렬화).
    await this.resetMonthlyPool(authorId, now)
    const refreshed = await this.getPlan(authorId)
    return { reset: true, plan: refreshed }
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
