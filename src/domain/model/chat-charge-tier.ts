/**
 * 크레딧 개편 I Phase (2026-05-17) — 채팅 4구간 차감 + 분석·테마 정액 차감.
 *
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-4
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §11 §30
 *
 * §8-8 CRITICAL 준수:
 *   #1 차감 N(190·810·3,390·5,520·2,440·590pt)은 cost-accountant v3 스트레스 원가
 *      `ceil(스트레스원가×3 ÷ ₩0.09856)` 산출값 — 본 모듈은 입력으로만 수용, 재산출 0건.
 *   #4 채팅 4구간 분리 필수 — 3구간 시 P99 꼬리 2.40× §0 위반. xlong 구간 필수.
 *
 * 경계값(500/4,000/12,000 tok)은 §8-4 가정값 — 운영 1~2주 실측 후 재확정.
 * 운영 중 재확정 대비, 경계값·차감 N 은 SystemSetting 동적 오버라이드 가능
 * (credit-system-setting.ts 의 loadChatChargeTiers). 본 파일은 §8 기본값 정본.
 *
 * 헥사고날상 domain 순수 영역 — Prisma/NestJS import 0건.
 */

/** 채팅 차감 구간 4종 (§8-4 — 3구간 금지) */
export type ChatChargeTier = 'short' | 'normal' | 'long' | 'xlong'

/** 채팅 4구간 차감 정의 (§8-4 기본값 — SystemSetting 으로 동적 오버라이드 가능) */
export interface ChatChargeTierDef {
  /** 구간 식별자 */
  tier: ChatChargeTier
  /** 이 구간의 input 토큰 상한 (이하 포함). 마지막 구간은 Infinity */
  inputMax: number
  /** 차감 포인트 (스트레스 원가 × 3 기반 — §8-8 #1, 재산출 금지) */
  points: number
}

/**
 * 채팅 4구간 차감 기본값 (§8-4 cost-accountant v3 확정).
 * - short:  ≤ 500 tok      → 190 pt  (스트레스 3.05×)
 * - normal: 501 ~ 4,000    → 810 pt  (스트레스 3.03×)
 * - long:   4,001 ~ 12,000 → 3,390 pt (스트레스 3.01×)
 * - xlong:  > 12,000       → 5,520 pt (스트레스 3.00× — 쿠션 0)
 */
export const CHAT_CHARGE_TIERS: readonly ChatChargeTierDef[] = [
  { tier: 'short', inputMax: 500, points: 190 },
  { tier: 'normal', inputMax: 4000, points: 810 },
  { tier: 'long', inputMax: 12000, points: 3390 },
  { tier: 'xlong', inputMax: Number.POSITIVE_INFINITY, points: 5520 },
] as const

/** 분석 1회 정액 차감 — 구 ANALYSIS_CREDIT_COST=4 디노미 환산 (§8-4, 스트레스 3.01×) */
export const ANALYSIS_POINT_COST = 2440

/** 테마 AI 생성 1회 정액 차감 — 구 1 크레딧 디노미 환산 (§8-4, 스트레스 3.01×) */
export const THEME_POINT_COST = 590

/**
 * input 토큰 수로 채팅 차감 구간 판정.
 *
 * §8-4 — 채팅은 4구간 정액 차감. 토큰은 API 응답 후 확정 → 사후 차감 시점에 호출.
 * 경계는 "이하 포함" — 정확히 500 tok 이면 short, 501 tok 이면 normal (off-by-one 주의).
 *
 * @param inputTokens API 응답 usage.input_tokens (0 이상 정수)
 * @param tiers 구간 정의 (기본 CHAT_CHARGE_TIERS — SystemSetting 오버라이드 시 주입)
 * @returns 해당 구간 정의 (tier + points)
 * @throws Error inputTokens 가 음수
 */
export function resolveChatChargeTier(
  inputTokens: number,
  tiers: readonly ChatChargeTierDef[] = CHAT_CHARGE_TIERS,
): ChatChargeTierDef {
  if (!Number.isFinite(inputTokens) || inputTokens < 0) {
    throw new Error(`input 토큰 수는 0 이상이어야 합니다: ${inputTokens}`)
  }
  // 오름차순 inputMax 를 순회 — 첫 번째로 inputTokens <= inputMax 인 구간.
  for (const def of tiers) {
    if (inputTokens <= def.inputMax) {
      return def
    }
  }
  // tiers 마지막 구간 inputMax 가 Infinity 이므로 여기 도달 불가 — 방어적 fallback.
  return tiers[tiers.length - 1]
}

/**
 * input 토큰 수로 채팅 차감 포인트 계산 (구간 판정 + 차감 N 추출).
 *
 * @param inputTokens API 응답 usage.input_tokens
 * @param tiers 구간 정의 (기본 CHAT_CHARGE_TIERS)
 * @returns 차감 포인트 (양수)
 */
export function resolveChatChargePoints(
  inputTokens: number,
  tiers: readonly ChatChargeTierDef[] = CHAT_CHARGE_TIERS,
): number {
  return resolveChatChargeTier(inputTokens, tiers).points
}
