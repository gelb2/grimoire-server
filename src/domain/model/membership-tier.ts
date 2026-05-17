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
