/**
 * USER-SOFT-DELETE sprint (2026-05-15) — GDPR 익명화 영역 포트 인터페이스.
 *
 * 정본: .claude/state/sprint-user-soft-delete-draft.md §11 + §7-1 GDPR 익명화 옵션 매트릭스
 * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
 *
 * 옵션 A (basic — 사용자 5/15 채택) 정합:
 * - email → `anonymized-{uuid}@deleted.local` (재로그인 차단 + 식별 영역 0)
 * - name → `Deleted Author`
 * - passwordHash → null (재로그인 영역 차단)
 * - bio → null (식별 영역 영역 0)
 *
 * 옵션 B (strong) + C (strongest) 영역 = 향후 환경변수 영역 영역 확장 영역 (본 sprint = basic 강제).
 */
export interface UserAnonymizerPort {
  /**
   * Author 식별 정보 anonymize 영역.
   *
   * @param authorId 익명화 대상 Author ID
   * @param scope 익명화 범위 (basic / strong / strongest). 기본 basic.
   * @returns void (anonymize 종료 정합)
   */
  anonymize(
    authorId: string,
    scope?: 'basic' | 'strong' | 'strongest',
  ): Promise<void>
}
