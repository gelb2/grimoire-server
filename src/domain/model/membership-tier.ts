/**
 * 크레딧 개편 I Phase (2026-05-17) — 멤버십 등급 + 월 포인트 풀.
 *
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-3
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §11 §30
 *
 * §8-3 — 구독은 테마 슬롯 + 월 포인트 풀 병존 차등.
 * - 월 포인트 풀은 채팅·테마·분석 3기능 공용.
 * - 풀 이월 금지 (§8-8 #2 — 무제한 이월 시 §0 0.14× 붕괴). 매월 리셋.
 *
 * 헥사고날상 domain 순수 영역 — Prisma/NestJS import 0건.
 */

/** 멤버십 등급 3종 */
export type MembershipTier = 'free' | 'pro' | 'premium'

/**
 * 등급별 월 포인트 풀 크기 (§8-3 cost-accountant v3 확정).
 * - free:    0       (풀 없음 — 충전 pt 로만 채팅·분석 가능)
 * - pro:     93,000  (₩9,900 — 누적 스트레스 AI원가 ₩3,021 ≤ ₩3,300)
 * - premium: 191,500 (₩19,900 — 누적 스트레스 AI원가 ₩6,221 ≤ ₩6,633)
 */
export const MEMBERSHIP_MONTHLY_POOL: Record<MembershipTier, number> = {
  free: 0,
  pro: 93000,
  premium: 191500,
}

/** 등급별 월 가격 (KRW) — §8-3 */
export const MEMBERSHIP_PRICE_KRW: Record<MembershipTier, number> = {
  free: 0,
  pro: 9900,
  premium: 19900,
}

/** 등급별 테마 슬롯 (현행 THEME_SLOT_LIMITS 와 정합 — config.ts) */
export const MEMBERSHIP_THEME_SLOTS: Record<MembershipTier, number> = {
  free: 1,
  pro: 3,
  premium: 8,
}

/** 등급별 일일 무료 테마 생성 횟수 (현행 DAILY_FREE_LIMITS 와 정합 — config.ts) */
export const MEMBERSHIP_DAILY_FREE_THEME: Record<MembershipTier, number> = {
  free: 3,
  pro: 7,
  premium: 12,
}

/** MembershipTier 유효성 검증 */
export function isMembershipTier(value: string): value is MembershipTier {
  return value === 'free' || value === 'pro' || value === 'premium'
}

/**
 * 임의 plan 문자열을 MembershipTier 로 정규화.
 * free/pro/premium 외 값은 'free' 폴백 (마이그레이션 안전망 — migration.sql §B-(c) 정합).
 */
export function normalizeMembershipTier(plan: string): MembershipTier {
  return isMembershipTier(plan) ? plan : 'free'
}

/** 등급의 월 풀 크기 조회 */
export function monthlyPoolFor(tier: MembershipTier): number {
  return MEMBERSHIP_MONTHLY_POOL[tier]
}

/**
 * CC-5 (HIGH-1 案 B) — `MembershipPlan` 을 tier 정본으로 사용할 때의 폴백 헬퍼.
 *
 * `MembershipPlanPort.getPlan` 이 정본 출처이나, 멤버십 row 가 없는 작가(마이그레이션 누락 /
 * 신규 가입 직후)는 null 을 반환한다. 案 B 이행 시 `Author.plan`(deprecated) 대신 이 헬퍼로
 * tier 를 결정 — plan 부재·non-active 는 'free' 폴백.
 *
 * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §5-A 案 B / ADR-014 案 B 전환.
 *
 * @param plan `getPlan` 반환값 (null 가능). `tier`/`status` 만 사용.
 */
export function resolveTierOrFree(
  plan: { tier: string; status: string } | null,
): MembershipTier {
  // plan row 부재 — 멤버십 미가입 작가 → free
  if (!plan) return 'free'
  // non-active(expired/cancelled) — 구독 종료 작가 → free 다운그레이드
  if (plan.status !== 'active') return 'free'
  return normalizeMembershipTier(plan.tier)
}
