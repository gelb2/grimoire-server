/**
 * 크레딧 개편 CC-2b (2026-05-20) — 응원 선물 단위 (pt) 정본.
 *
 * 정본: `.claude/state/sprint-credit-overhaul-s-phase-draft.md` §8-6
 *       `.claude/state/sprint-cc2b-gift-refund-wiring-plan-draft.md` §6 (메인 결정 박제)
 *       reports/CREDIT_CORE_DIAGNOSIS.md §1-B
 *
 * §8-6 — 응원 선물 3단계: 구 1·3·5 크레딧 → 디노미 1:1,000 환산 1,000·3,000·5,000pt.
 * CC-2b 메인 결정: S Phase 잠정값 그대로 승인. `POST /credits/gift` body `amount` 단위 = pt.
 *
 * §0 위상: 선물은 매출 0(독자↔작가 포인트 이동) → cost-accountant §0 마진 검증 무관.
 * shared-contracts §30 변경 이력에 단위 박제(`gift` body `amount` = pt 단위).
 *
 * 헥사고날상 domain 순수 영역 — Prisma/NestJS import 0건.
 */

/** 응원 선물 단위 3단계 (pt, 메인 결정 — CC-2b §6) */
export const GIFT_POINT_OPTIONS = [1000, 3000, 5000] as const

/** GIFT_POINT_OPTIONS 의 단일 값 타입 */
export type GiftPointOption = (typeof GIFT_POINT_OPTIONS)[number]

/** 입력값이 정본 선물 단위 3단계에 속하는지 검증 */
export function isGiftPointOption(value: number): value is GiftPointOption {
  return GIFT_POINT_OPTIONS.includes(value as GiftPointOption)
}
