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
 * 크레딧 충전 패키지 목록 — 크레딧 개편 §8-5 / `docs/ai-cost-table.md` §2 정본.
 *
 * CC-2a (2026-05-20) — 디노미네이션 개편: 구 3종(credit-5/20/50, `credits` Int=패키지 수량)
 * → 신 4종(입문/기본/인기/베스트, `points` Int=총 충전 포인트 pt).
 *
 * 필드:
 * - `points`: 총 충전 포인트 (기본 + 보너스, pt 단위). `Payment.credits` 컬럼에 그대로 저장
 *   (MEDIUM-4 — `Payment.credits` Int 의미를 "패키지 수량"→"pt"로 재해석. 컬럼 물리 rename 은
 *   마이그레이션 동반 → CC-2a 범위 외, 계획 §5 C5d). `completePaymentWithPoints`에 넘기는 값.
 * - `bonusRate`: 보너스 비율 (입문·기본 0 / 인기 0.10 / 베스트 0.15 — §8-5 안전 권고 상한).
 * - `price`: 충전액 (원화 KRW) — ai-cost-table §2 정본.
 * - `priceUsd`: Polar 결제용 USD 센트 — Polar Product 실 결제 금액. 기존 Polar 패턴
 *   "₩X,000 = $X.99" 유지 (₩3,000→$2.99 / ₩5,000→$4.99 / ₩10,000→$9.99 / ₩30,000→$29.99).
 * - `providerProductIdEnv`: 해당 Polar Product id 환경변수. 입문은 신규 `POLAR_PRODUCT_STARTER`
 *   (Polar Dashboard 상품 등록은 infrastructure/사용자 영역 — 진단 §7-2).
 *
 * §0 원가 검증: 4종 전부 cost-accountant 승인 `786b0f3`으로 §0 PASS 판정 완료
 *   (입문 실효 순단가 ₩0.09856 = §0 최악 기준 ~ 베스트 ₩0.09976, ai-cost-table §2/§7-4).
 *   CC-2a 는 신규 AI 기능 추가 0건 — 기존 충전 경로의 디노미 환산이므로 재마진검증 불요.
 */
export const CREDIT_PRODUCTS = [
  {
    id: 'credit-starter',
    name: '입문 패키지',
    points: 25000,
    bonusRate: 0,
    price: 3000,
    priceUsd: 299,
    providerProductIdEnv: 'POLAR_PRODUCT_STARTER',
  },
  {
    id: 'credit-basic',
    name: '기본 패키지',
    points: 41667,
    bonusRate: 0,
    price: 5000,
    priceUsd: 499,
    providerProductIdEnv: 'POLAR_PRODUCT_BASIC',
  },
  {
    id: 'credit-popular',
    name: '인기 패키지',
    points: 91667,
    bonusRate: 0.1,
    price: 10000,
    priceUsd: 999,
    providerProductIdEnv: 'POLAR_PRODUCT_POPULAR',
  },
  {
    id: 'credit-best',
    name: '베스트 패키지',
    points: 287500,
    bonusRate: 0.15,
    price: 30000,
    priceUsd: 2999,
    providerProductIdEnv: 'POLAR_PRODUCT_BEST',
  },
] as const

export type Product = (typeof CREDIT_PRODUCTS)[number]
