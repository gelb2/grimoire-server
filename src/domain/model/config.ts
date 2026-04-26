/**
 * 비즈니스 설정값 — UseCase에서 참조
 * 향후 DB/환경변수로 이관 가능하도록 도메인 모델에 분리
 */

/** 구독 플랜별 테마 슬롯 제한 */
export const THEME_SLOT_LIMITS: Record<string, number> = {
  free: 1,
  pro: 3,
  premium: 8,
}

/** 구독 플랜별 일일 무료 생성 제한 — PLANNING_GRIMOIRE.md §8 기준 */
export const DAILY_FREE_LIMITS: Record<string, number> = {
  free: 3,
  pro: 7,
  premium: 12,
}

/**
 * AI 작품 분석 1회 차감 크레딧 — PLANNING §14 / ai-cost-table.md §3-2.
 *
 * 박제 이력:
 * - F2 2026-04-19: 3 크레딧 확정 (Sonnet 4.6, 베스트 안전배수 3.14× PASS)
 * - 2026-04-27 #9 사용자 결정: 3 → 4 크레딧 인상 (cost-accountant 시뮬 검증)
 *   - 사유: Sonnet +20% 시뮬 시 베스트 2.79× / 인기 2.96× → §0 위반 FAIL 약점
 *   - 환율 +8.5% 시뮬 시 베스트 2.98× FAIL
 *   - 4 크레딧 인상 후: 베스트 3.73× / 인기 3.61× / 기본 3.48× (모두 PASS)
 *   - +20% 시뮬 후 베스트 3.35× → FAIL 약점 완전 해소
 */
export const ANALYSIS_CREDIT_COST = 4

/**
 * 크레딧 상품 목록 — PLANNING_GRIMOIRE.md §8 기준
 *
 * `price`: 원화(KRW) 기준 — 기획서 정본
 * `priceUsd`: Polar 결제용 USD 센트 — Polar Product에 설정된 실제 결제 금액
 * 실제 결제 시 `POLAR_PRODUCT_*` 환경변수에 해당하는 Polar Product로 라우팅.
 *
 * F1 인상 (2026-04-19): 기본 패키지 ₩1,000→₩2,000
 *   배경: Polar 고정수수료 $0.30(₩442)가 구 ₩1,000의 44%를 잠식 → 안전배수 1.84× CRITICAL.
 *   대응: ₩2,000으로 인상, 개당 ₩400 확보 → 안전배수 3.49× PASS.
 *   USD 매핑: 기존 Polar 패턴 "₩X,000 = $X.99" 유지 → $0.99 → $1.99 (199센트).
 *   Polar Dashboard에서 POLAR_PRODUCT_BASIC 상품 금액 $0.99 → $1.99 변경 완료 (2026-04-19).
 */
export const CREDIT_PRODUCTS = [
  {
    id: 'credit-5',
    name: '5 크레딧',
    credits: 5,
    price: 2000,
    priceUsd: 199,
    providerProductIdEnv: 'POLAR_PRODUCT_BASIC',
  },
  {
    id: 'credit-20',
    name: '20 크레딧',
    credits: 20,
    price: 3000,
    priceUsd: 299,
    providerProductIdEnv: 'POLAR_PRODUCT_POPULAR',
  },
  {
    id: 'credit-50',
    name: '50 크레딧',
    credits: 50,
    price: 5000,
    priceUsd: 499,
    providerProductIdEnv: 'POLAR_PRODUCT_BEST',
  },
] as const

export type Product = (typeof CREDIT_PRODUCTS)[number]
