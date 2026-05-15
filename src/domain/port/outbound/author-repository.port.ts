import { Author } from '@domain/model/author'

export interface AuthorRepositoryPort {
  findById(id: string): Promise<Author | null>
  findBySlug(slug: string): Promise<Author | null>
  findByEmail(email: string): Promise<Author | null>
  findBySocialAccount(provider: string, providerId: string): Promise<Author | null>
  create(input: { slug: string; name: string; email: string; passwordHash?: string }): Promise<Author>
  updateCredits(id: string, credits: number): Promise<Author>
  linkSocialAccount(authorId: string, provider: string, providerId: string, email?: string): Promise<void>
  /** 이름 또는 슬러그로 작가 검색 (LIKE) */
  search(query: string, limit: number): Promise<Author[]>
  /** 작가 프로필(name, bio) 업데이트 */
  updateProfile(id: string, data: { name?: string; bio?: string }): Promise<Author>
  /** 전체 작가 수 */
  count(): Promise<number>
  /** 구독 플랜 업데이트 */
  updatePlan(id: string, plan: string, planExpireAt: Date | null): Promise<Author>
  /** 비밀번호 해시 업데이트 */
  updatePasswordHash(id: string, passwordHash: string): Promise<Author>
  /** 전체 작가 목록 조회 (관리자용, 페이지네이션) */
  findAll(options: { page: number; limit: number; query?: string }): Promise<{ items: Author[]; total: number }>
  /** 작가 역할 변경 */
  updateRole(id: string, role: string): Promise<Author>
  /** 작가 삭제 (USER-SOFT-DELETE 적용 후: soft delete 영역 변환 — middleware 영역 또는 명시 영역 정합) */
  deleteById(id: string): Promise<void>
  /** 작가 기본 테마 설정 */
  updateDefaultThemeId(id: string, themeId: string | null): Promise<Author>

  // ─── USER-SOFT-DELETE sprint (2026-05-15) ───

  /**
   * Author soft delete 영역 적용 영역 (deletedAt = NOW).
   * 본인 탈퇴 / 운영자 강제 삭제 영역 정합 강제.
   *
   * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
   */
  softDelete(id: string): Promise<void>

  /**
   * Author soft delete 영역 복구 영역 (deletedAt = null).
   * 운영자 영역 명시 영역만 강제 (본인 영역 복구 0건 — 재가입 영역 정합).
   */
  restore(id: string): Promise<void>

  /**
   * Author hard delete 영역 (PG row 영구 삭제 영역, deleteMany 영역).
   * 30일 cron 영역 정합 강제 — 회계 8건 Restrict 영역 PG 자동 차단 시 P2003 영역 try-catch 영역.
   *
   * @param cutoff deletedAt < cutoff 영역 영역 영역 대상
   * @returns hard delete 영역 영역 매트릭스 (성공 + 실패 + 회계 차단)
   */
  hardDeleteOlderThan(cutoff: Date): Promise<{
    deletedIds: string[]
    blockedIds: string[]
  }>

  /**
   * deletedAt = NOT NULL 영역 영역 박제 영역 (운영자 영역 영역 조회).
   * middleware 영역 우회 영역 (raw query 영역 영역).
   */
  findDeletedById(id: string): Promise<Author | null>

  /**
   * soft deleted Author 영역 영역 30일 영역 영역 조회 영역 (cron 영역 영역 정합).
   * @param cutoff deletedAt < cutoff 영역 영역 영역 대상
   */
  findDeletedOlderThan(cutoff: Date): Promise<Author[]>
}
