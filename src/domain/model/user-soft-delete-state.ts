/**
 * USER-SOFT-DELETE sprint (2026-05-15) — Author soft delete 영역 상태 enum.
 *
 * Author 영역 4 상태 영역 박제:
 * - ACTIVE: 정상 활성 (deletedAt = null)
 * - SOFT_DELETED: 본인 탈퇴 / 운영자 강제 삭제 (deletedAt = NOW, 본문 영역 미접근 + 로그인 차단)
 * - ANONYMIZED: GDPR 익명화 종료 (email/name/passwordHash 영역 anonymize 종료)
 * - HARD_DELETED: 30일 후 cron 영역 hard delete 종료 (PG row 영역 영구 삭제, 회계 영역 Restrict 차단 시 보류)
 *
 * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
 * Draft: .claude/state/sprint-user-soft-delete-draft.md §5-1 DDD-aware soft delete 패턴
 */
export enum SoftDeleteState {
  ACTIVE = 'ACTIVE',
  SOFT_DELETED = 'SOFT_DELETED',
  ANONYMIZED = 'ANONYMIZED',
  HARD_DELETED = 'HARD_DELETED',
}

/**
 * USER-SOFT-DELETE 영역 deletedBy 영역 박제.
 * - self: 사용자 본인 탈퇴 (DELETE /api/v1/authors/me 영역)
 * - admin: 운영자 강제 삭제 (DELETE /api/v1/admin/authors/:id 영역, AdminGuard 영역)
 */
export type SoftDeletedBy = 'self' | 'admin'
