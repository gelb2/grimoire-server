import { Author } from '@domain/model/author'

export interface AuthorRepositoryPort {
  findById(id: string): Promise<Author | null>
  findBySlug(slug: string): Promise<Author | null>
  findByEmail(email: string): Promise<Author | null>
  create(input: { slug: string; name: string; email: string; passwordHash?: string }): Promise<Author>
  updateCredits(id: string, credits: number): Promise<Author>
}
