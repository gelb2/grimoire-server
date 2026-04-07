/** 플랜 만기 여부 판단 — 순수 도메인 로직 */
export function isPlanExpired(plan: string, planExpireAt: Date | null): boolean {
  // free 플랜은 만기 없음
  if (plan === 'free') return false
  // 만기일 미설정 = 만기 없음
  if (!planExpireAt) return false
  // 만기일 경과 여부
  return planExpireAt < new Date()
}

/** 시스템 폴백 테마 프리셋 이름 — DB에서 조회할 때 사용 */
export const SYSTEM_FALLBACK_PRESET = 'midnight'
