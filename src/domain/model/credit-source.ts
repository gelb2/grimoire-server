/**
 * 크레딧 개편 I Phase (2026-05-17) — 포인트 출처 4종 + 소진 우선순위.
 *
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-2
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §11 §30
 *
 * §8-2 — 포인트 출처 4종을 분리 회계한다. 출처별 §0 위상이 다름:
 * - free:         무료 적립 (가입·첫작품) — 매출 0, CAC(마케팅비) 회계 분리
 * - subscription: 구독 월 풀 — "월 한도 누적원가 ≤ 구독료 ÷ 3", 매월 리셋·이월 금지
 * - gift:         응원 선물 (독자→작가) — 독자 결제 시 §0 이미 충족, 재검증 불요
 * - charged:      충전 (Polar) — pt 단가에 §0 박힘, 영구 보존
 *
 * 헥사고날상 domain 순수 영역 — Prisma/NestJS import 0건.
 */

/** 포인트 출처 4종 (§8-2 분리 회계) */
export type CreditSource = 'free' | 'subscription' | 'gift' | 'charged'

/** ledger 엔트리 타입 */
export type CreditLedgerType =
  | 'earn'
  | 'spend'
  | 'deficit_incur'
  | 'deficit_settle'
  | 'expire'

/**
 * 소진 우선순위 (§8-2) — 인덱스 0이 최우선 소진.
 * 무료적립 → 구독풀 → 응원선물 → 충전.
 * (만료성 자원 우선 소진 + CAC/COGS 분리 집계 — 영구 보존인 충전을 마지막에)
 */
export const CREDIT_CONSUMPTION_ORDER: readonly CreditSource[] = [
  'free',
  'subscription',
  'gift',
  'charged',
] as const

/** CreditSource 유효성 검증 */
export function isCreditSource(value: string): value is CreditSource {
  return (
    value === 'free' ||
    value === 'subscription' ||
    value === 'gift' ||
    value === 'charged'
  )
}

/** CreditLedgerType 유효성 검증 */
export function isCreditLedgerType(value: string): value is CreditLedgerType {
  return (
    value === 'earn' ||
    value === 'spend' ||
    value === 'deficit_incur' ||
    value === 'deficit_settle' ||
    value === 'expire'
  )
}

/**
 * 출처별 §0 위상 — 회계 분리 시 사용.
 * - cac:  무료 적립 (매출 0, 마케팅비)
 * - cogs: 충전 + 구독풀 + 응원선물 (원가 대응 매출 有 — §0 ≥3배 적용 대상 또는 이미 충족)
 */
export const CREDIT_SOURCE_ACCOUNTING: Record<CreditSource, 'cac' | 'cogs'> = {
  free: 'cac',
  subscription: 'cogs',
  gift: 'cogs',
  charged: 'cogs',
}
