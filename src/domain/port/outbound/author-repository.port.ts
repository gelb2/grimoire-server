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
  /** 작가 삭제 */
  deleteById(id: string): Promise<void>
  /** 작가 기본 테마 설정 */
  updateDefaultThemeId(id: string, themeId: string | null): Promise<Author>
}
