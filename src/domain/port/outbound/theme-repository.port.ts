import { AuthorTheme, Theme } from '@domain/model/theme'

export interface ThemeRepositoryPort {
  findByAuthorId(authorId: string): Promise<Theme | null>
  findByAuthorSlug(slug: string): Promise<Theme | null>
  upsert(authorId: string, preset: string, overrides: AuthorTheme, rawDescription: string): Promise<Theme>
}
