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
 * 크레딧 상품 목록 — PLANNING_GRIMOIRE.md §8 기준
 *
 * `price`: 원화(KRW) 기준 — 기획서 정본
 * `priceUsd`: Polar 결제용 USD 센트 — Polar Product에 설정된 실제 결제 금액
 * 실제 결제 시 `POLAR_PRODUCT_*` 환경변수에 해당하는 Polar Product로 라우팅.
 */
export const CREDIT_PRODUCTS = [
  {
    id: 'credit-5',
    name: '5 크레딧',
    credits: 5,
    price: 1000,
    priceUsd: 99,
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
