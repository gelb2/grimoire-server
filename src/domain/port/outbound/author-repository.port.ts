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
  /** 작가 bio 업데이트 */
  updateBio(id: string, bio: string): Promise<Author>
}
