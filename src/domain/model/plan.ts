/**
 * CC-5 (HIGH-1 案 B) — `MembershipPlan` 정본 기반 만기 판단.
 *
 * 案 B 이행 후 tier 정본이 `MembershipPlan` 이므로, theme/plan 도메인의 "플랜 만료" 게이트도
 * `MembershipPlanState` 로 판정한다. 案 A 의 `isPlanExpired(Author.plan, Author.planExpireAt)` 대체.
 *
 * 판정:
 *  - plan null — 멤버십 미가입(free) → 만기 아님 (free 는 만기 개념 없음)
 *  - status='active' — 유효 (구독 진행 중) → 만기 아님
 *  - status='cancelled' / 'expired' — 구독 종료 → 만기
 *
 * 풀 리셋(`poolResetAt` 경과)은 만기가 아닌 "리셋 대상" — cron/lazy 가 처리하므로 여기서 미판정.
 *
 * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §5-A 案 B / ADR-014 案 B 전환.
 *
 * @param plan `MembershipPlanPort.getPlan` 반환값 (null 가능). `status` 만 사용.
 */
export function isMembershipExpired(
  plan: { status: string } | null,
): boolean {
  // 멤버십 미가입 — free, 만기 개념 없음
  if (!plan) return false
  // active 가 아니면 만기 (cancelled / expired)
  return plan.status !== 'active'
}

/** 시스템 폴백 테마 프리셋 이름 — DB에서 조회할 때 사용 */
export const SYSTEM_FALLBACK_PRESET = 'midnight'
