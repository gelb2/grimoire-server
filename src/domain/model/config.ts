/**
 * 비즈니스 설정값 — UseCase에서 참조
 * 향후 DB/환경변수로 이관 가능하도록 도메인 모델에 분리
 */

/** 구독 플랜별 테마 슬롯 제한 */
export const THEME_SLOT_LIMITS: Record<string, number> = {
  free: 1,
  pro: 5,
  premium: Infinity,
}

/** 구독 플랜별 일일 무료 생성 제한 */
export const DAILY_FREE_LIMITS: Record<string, number> = {
  free: 3,
  pro: 20,
  premium: Infinity,
}

/** 크레딧 상품 목록 */
export const CREDIT_PRODUCTS = [
  { id: 'credit-10', name: '10 크레딧', credits: 10, price: 1000 },
  { id: 'credit-30', name: '30 크레딧', credits: 30, price: 2500 },
  { id: 'credit-100', name: '100 크레딧', credits: 100, price: 7000 },
] as const

export type Product = (typeof CREDIT_PRODUCTS)[number]
