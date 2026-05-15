/**
 * USER-SOFT-DELETE sprint (2026-05-15) — Author soft delete 영역 정책 박제.
 *
 * 정합 박제:
 * - PAY-P3-E 단계 1~6 정합 (33 FK 영역 + 회계 8건 Restrict 영역) — Author hard delete 시 PG 자동 차단 정합 강제
 * - PAY-P3-E RefreshToken Cascade 정합 — Author soft delete 시점 RefreshToken 즉시 무효 정합 (별도 호출 강제)
 * - GDPR Article 17 정합 (Right to Erasure)
 *
 * 5/15 사용자 결정 박제 (§16 6 결정 영역 옵션 A 전부 채택):
 * - User soft delete 옵션 A: User.deletedAt DateTime? NULL ALLOW
 * - 작품/episode cascade 옵션 A: PAY-P3-E Restrict 정합 (archive 0건, soft delete 시점 작품 영역 보존)
 * - GDPR 익명화 옵션 A: basic (email/name/passwordHash/bio 익명화)
 * - 30일 hard delete 옵션 A: 자동 cron + 회계 차단 시 보류
 * - cron 시간 옵션 A: `0 4 * * *` 매일 새벽 4시
 *
 * 정본: .claude/state/sprint-user-soft-delete-draft.md §1-2 + §7
 * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
 */
export interface UserSoftDeletePolicy {
  /** 30일 후 hard delete (단위: 일). 기본 30. */
  retentionDays: number
  /** cron 시간 영역 (NestJS @Cron 표현). 기본 '0 4 * * *' (매일 새벽 4시) */
  cronTime: string
  /** GDPR 익명화 범위. basic = email + name + passwordHash + bio (기본 A) */
  anonymizeScope: 'basic' | 'strong' | 'strongest'
}

/**
 * USER-SOFT-DELETE 영역 기본 정책 영역 (옵션 A 5건 정합 박제).
 *
 * 환경변수 영역 override 가능 영역:
 * - `USER_SOFT_DELETE_RETENTION_DAYS` (기본 30)
 * - `USER_SOFT_DELETE_CRON_TIME` (기본 '0 4 * * *')
 * - `GDPR_ANONYMIZE_SCOPE` (기본 'basic')
 */
export const DEFAULT_USER_SOFT_DELETE_POLICY: UserSoftDeletePolicy = {
  retentionDays: 30,
  cronTime: '0 4 * * *',
  anonymizeScope: 'basic',
}

/**
 * 환경변수 영역 영역 정책 영역 로드 영역.
 * 정합 박제: 환경별 분리 0건 (사용자 5/15 결정 영역 — 단일 정합 강제) — env 영역 영역만 변동 허용.
 */
export function loadUserSoftDeletePolicy(): UserSoftDeletePolicy {
  const retentionDays = parseInt(
    process.env.USER_SOFT_DELETE_RETENTION_DAYS ?? '30',
    10,
  )
  const cronTime = process.env.USER_SOFT_DELETE_CRON_TIME ?? '0 4 * * *'
  const anonymizeScope = (process.env.GDPR_ANONYMIZE_SCOPE ?? 'basic') as
    | 'basic'
    | 'strong'
    | 'strongest'

  return {
    retentionDays: Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 30,
    cronTime,
    anonymizeScope,
  }
}

/**
 * USER-SOFT-DELETE 영역 30일 cutoff 영역 계산 영역.
 *
 * @param now 현재 시각 (테스트 영역 주입 강제)
 * @param retentionDays 보존 기간 (기본 30)
 * @returns cutoff 시각 — deletedAt < cutoff 영역 hard delete 영역 대상
 */
export function computeHardDeleteCutoff(now: Date, retentionDays: number = 30): Date {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - retentionDays)
  return cutoff
}
