import { EmailTokenPurpose } from '@domain/model/email-verification-token'

/**
 * EmailVerificationTokenRepositoryPort (EMAIL-POLAR-READY Phase C).
 *
 * 정본: `.claude/state/sprint-email-polar-ready-plan-draft.md` §7
 */

export interface EmailVerificationTokenRecord {
  id: string
  authorId: string
  email: string
  tokenHash: string
  purpose: EmailTokenPurpose
  expireAt: Date
  redeemedAt: Date | null
  createdAt: Date
}

export interface EmailVerificationTokenRepositoryPort {
  /** 신 토큰 박제 (sha256 hash 만 저장 — 평문은 호출자 메모리만) */
  create(input: {
    authorId: string
    email: string
    tokenHash: string
    purpose: EmailTokenPurpose
    expireAt: Date
  }): Promise<EmailVerificationTokenRecord>

  /** tokenHash 로 조회 — verify 진입점 (O(1) unique 인덱스) */
  findByTokenHash(tokenHash: string): Promise<EmailVerificationTokenRecord | null>

  /** 토큰 redeem 표식 — 재사용 차단 (race 시 P2002 unique 위반 영역은 redeemedAt 컬럼) */
  markRedeemed(id: string, redeemedAt: Date): Promise<void>

  /** 만료 토큰 일괄 삭제 — cron 정리용 (purpose 무관, expireAt < now) */
  deleteExpired(now: Date): Promise<{ count: number }>
}
