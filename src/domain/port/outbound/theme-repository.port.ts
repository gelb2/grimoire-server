import { AuthorTheme, Theme } from '@domain/model/theme'

export interface ThemeRepositoryPort {
  findById(id: string): Promise<Theme | null>
  findAllByAuthorId(authorId: string): Promise<Theme[]>
  findByAuthorSlug(slug: string): Promise<Theme | null>
  countByAuthorId(authorId: string): Promise<number>
  create(authorId: string, name: string, preset: string, overrides: AuthorTheme, rawDescription: string): Promise<Theme>
  update(themeId: string, preset: string, overrides: AuthorTheme, rawDescription: string): Promise<Theme>
  delete(themeId: string): Promise<void>
  updateBakedCssUrl(themeId: string, url: string): Promise<void>
  countSlottedByAuthorId(authorId: string): Promise<number>
  updateSlotStatus(themeId: string, isSlotted: boolean): Promise<Theme>
  findSlottedByAuthorId(authorId: string): Promise<Theme[]>
  unslotAllByAuthorId(authorId: string): Promise<void>
}
