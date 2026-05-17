/**
 * 크레딧 개편 I Phase (2026-05-17) — MembershipPlan 구독 등급 + 월 풀 포트.
 *
 * 정본: .claude/shared-contracts.md §30 CreditOverhaul
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §5, §11
 *
 * 4-C 구조 — MembershipPlan(등급/풀 메타) + CreditLedger(source='subscription' 적립/만료).
 * 월간 리셋은 reset-monthly-pool.job 이 cron + lazy 이중 안전망으로 수행.
 *
 * 헥사고날 — domain 레이어. Prisma import 0건.
 */

import { MembershipTier } from '@domain/model/membership-tier'

/** MembershipPlan 상태 — 도메인 표현 */
export interface MembershipPlanState {
  id: string
  authorId: string
  tier: MembershipTier
  /** 월 풀 크기 (등급별 — free 0 / pro 93,000 / premium 191,500) */
  monthlyPoolPoints: number
  /** 현재 잔여 풀 (캐시 — 리셋 시 monthlyPoolPoints 로 재설정) */
  poolBalance: number
  /** 다음 리셋 시각 */
  poolResetAt: Date
  startedAt: Date
  expiresAt: Date | null
  /** Polar 구독 결제 연동 (별도 sprint) */
  polarSubscriptionId: string | null
  status: 'active' | 'expired' | 'cancelled'
}

export interface MembershipPlanPort {
  /** 작가의 활성 멤버십 조회 (없으면 null) */
  getPlan(authorId: string): Promise<MembershipPlanState | null>

  /**
   * 월간 풀 리셋 — poolBalance = monthlyPoolPoints (이월 금지, §8-8 #2).
   * $transaction: 기존 구독풀 ledger 만료(expire) + 신규 풀 ledger(earn, source='subscription')
   *               + MembershipPlan.poolBalance/poolResetAt 갱신 + Author.pointsSubscription 캐시 동기.
   * @param now 현재 시각 (테스트 주입)
   */
  resetMonthlyPool(authorId: string, now: Date): Promise<void>

  /**
   * 리셋 대상 조회 — poolResetAt 경과 + status='active' + tier!='free'.
   * cron(reset-monthly-pool.job)이 이 목록을 순회해 resetMonthlyPool 호출.
   */
  findPlansToReset(now: Date): Promise<MembershipPlanState[]>

  /**
   * 멤버십 등급 변경 (구독 가입/변경 — Polar 연동 별도 sprint).
   * 등급 변경 시 풀 크기 갱신.
   */
  changeTier(authorId: string, tier: MembershipTier, now: Date): Promise<MembershipPlanState>
}
