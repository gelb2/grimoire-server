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

/** 구독 플랜별 일일 무료 생성 제한 */
export const DAILY_FREE_LIMITS: Record<string, number> = {
  free: 3,
  pro: 20,
  premium: Infinity,
}

/**
 * 크레딧 상품 목록
 *
 * `price`: 내부 원화 기준 (기존 기획서). 현재 Polar는 USD 기준으로 운영 중.
 * 실제 결제 시 `POLAR_PRODUCT_*` 환경변수에 해당하는 Polar Product로 라우팅.
 * 결제 프로바이더별 매핑은 `providerProductIdEnv`를 참조.
 */
export const CREDIT_PRODUCTS = [
  {
    id: 'credit-10',
    name: '10 크레딧',
    credits: 10,
    price: 1000,
    providerProductIdEnv: 'POLAR_PRODUCT_BASIC',
  },
  {
    id: 'credit-30',
    name: '30 크레딧',
    credits: 30,
    price: 2500,
    providerProductIdEnv: 'POLAR_PRODUCT_POPULAR',
  },
  {
    id: 'credit-100',
    name: '100 크레딧',
    credits: 100,
    price: 7000,
    providerProductIdEnv: 'POLAR_PRODUCT_BEST',
  },
] as const

export type Product = (typeof CREDIT_PRODUCTS)[number]
