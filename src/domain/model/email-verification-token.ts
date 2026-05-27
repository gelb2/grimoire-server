import * as crypto from 'crypto'

/**
 * EmailVerificationToken — 이메일 인증/비밀번호 초기화 토큰 도메인 모델 (EMAIL-POLAR-READY Phase C).
 *
 * 정본: `.claude/state/sprint-email-polar-ready-plan-draft.md` §7
 *
 * 보안 규약:
 * - 평문 토큰은 발송 시점만 메모리에 존재, DB에는 sha256 hash만 박제
 * - pepper(`EMAIL_TOKEN_PEPPER` env)로 hash 강화 — env 미설정 시 빈 문자열 폴백(개발용)
 * - 토큰 길이: 32바이트(256비트) base64url — 무차별 대입 비현실적
 */

export type EmailTokenPurpose = 'verify_email' | 'password_reset'

/** 만료 기간 매트릭스 — 보안 정책 단일 정본 */
export const TOKEN_EXPIRE_MINUTES: Record<EmailTokenPurpose, number> = {
  verify_email: 60, // 1시간
  password_reset: 30, // 30분 (더 짧게 — 비밀번호 노출 위험 최소화)
}

/** 토큰 평문 생성 — 32바이트 random → base64url */
export function generatePlainToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** 토큰 hash — sha256(token + pepper) — DB 박제용 */
export function hashToken(plainToken: string): string {
  const pepper = process.env.EMAIL_TOKEN_PEPPER ?? ''
  return crypto.createHash('sha256').update(plainToken + pepper).digest('hex')
}

/** 만료 시각 계산 — 발급 시점 + 분 단위 */
export function calculateExpireAt(purpose: EmailTokenPurpose, issuedAt: Date = new Date()): Date {
  const minutes = TOKEN_EXPIRE_MINUTES[purpose]
  return new Date(issuedAt.getTime() + minutes * 60 * 1000)
}

/** 토큰 사용 가능 여부 — 만료 + redeem 동시 검증 */
export function isTokenUsable(token: {
  expireAt: Date
  redeemedAt: Date | null
}, now: Date = new Date()): { usable: boolean; reason?: 'expired' | 'redeemed' } {
  if (token.redeemedAt !== null) {
    return { usable: false, reason: 'redeemed' }
  }
  if (token.expireAt.getTime() <= now.getTime()) {
    return { usable: false, reason: 'expired' }
  }
  return { usable: true }
}
