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

/**
 * lazy 안전망 결과 — CC-3 (CRITICAL-1 案 B).
 *
 * `getPointBalance` 등 잔액 조회 진입점에서 plan 만료(poolResetAt < now) 시 즉시
 * `resetMonthlyPool` 호출 후 갱신 plan 반환. cron 실패 시 코드 강제로 이월 금지 보장.
 */
export interface LazyResetResult {
  /** resetMonthlyPool 실행 여부 (free/미만료/non-active 시 false) */
  reset: boolean
  /** 호출 직후 plan 상태 (없으면 null) */
  plan: MembershipPlanState | null
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
   * 멤버십 등급 변경 — 구독 가입/변경(Polar 연동) + 관리자 수동 등급 변경 단일 진입점.
   * 등급 변경 시 풀 크기 갱신.
   *
   * CC-5 (HIGH-1 案 B, ADR-014 案 B 전환) — `MembershipPlan.tier` 가 **정본**.
   * application 레이어의 tier 읽기는 전부 `getPlan` 경유 — `Author.plan` 직접 읽기 0건.
   * `changeTier` 는 案 A 미러로 `Author.plan` + `planExpireAt` 도 동기 갱신 — `Author.plan` 컬럼
   * 물리 DROP(별도 후속 sprint) 전까지 stale 방지용 미러 (DROP 시점에 미러 코드 제거).
   *
   * CC-5 — `polarSubscriptionId` 인자(Optional): Polar 구독 결제 매핑 저장.
   * 전달 시 `$transaction` 안에서 `MembershipPlan.polarSubscriptionId` 갱신.
   * 미전달(관리자 수동 등급 변경 등) 시 기존 매핑 보존.
   */
  changeTier(
    authorId: string,
    tier: MembershipTier,
    now: Date,
    polarSubscriptionId?: string,
  ): Promise<MembershipPlanState>

  /**
   * lazy 안전망 — 잔액 조회 진입점에서 plan 만료 시 즉시 리셋.
   *
   * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §4 案 B (cron + lazy 이중 안전망)
   *       ADR-014 — CRITICAL-1 案 B 채택 (S Phase draft §8-6 원안 복원, I Phase 후속)
   *
   * 동작:
   *   - plan null 또는 tier='free' 또는 status!='active' → no-op return `{reset: false, plan}`
   *   - `plan.poolResetAt > now` → no-op return `{reset: false, plan}` (만료 안 됨)
   *   - `plan.poolResetAt <= now` → `resetMonthlyPool(authorId, now)` 호출 후
   *     갱신 plan 재조회 return `{reset: true, plan: 재조회}`
   *
   * 동시성: `resetMonthlyPool` 내부 `Author FOR UPDATE` 직렬화 + `monthlyPoolFor(tier)` 결정적
   *         → 동시 2회 호출 시 두 번째는 첫 트랜잭션 완료 후 동일 newPool 재설정(외부 관찰 동일).
   *
   * 호출 비용:
   *   - 평소(미만료/free) — `getPlan` 1 SELECT (인덱스 hit).
   *   - 만료 시점에만 `resetMonthlyPool` 1 $transaction.
   *
   * lazy 실패는 caller 가 silent log 후 진행 — 잔액 조회 자체 실패 방지 (fallback 안전망).
   */
  checkAndResetExpiredPool(authorId: string, now: Date): Promise<LazyResetResult>
}
