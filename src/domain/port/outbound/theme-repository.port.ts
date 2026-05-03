import { AuthorTheme, Theme } from '@domain/model/theme'

export interface ThemeRepositoryPort {
  findById(id: string): Promise<Theme | null>
  findAllByAuthorId(authorId: string): Promise<Theme[]>
  findByAuthorSlug(slug: string): Promise<Theme | null>
  countByAuthorId(authorId: string): Promise<number>
  create(authorId: string, name: string, preset: string, overrides: AuthorTheme, rawDescription: string, source?: string): Promise<Theme>
  update(themeId: string, preset: string, overrides: AuthorTheme, rawDescription: string, source?: string, name?: string): Promise<Theme>
  delete(themeId: string): Promise<void>
  /**
   * baked_css_url 갱신.
   * - string: Blob CDN 절대 URL
   * - null: Blob 비활성/실패 시 폴백 (응답 시 server가 동적 절대화)
   * 상대 경로(`/api/themes/css/...`)는 박제 금지 (2026-05-03 P1-#7).
   */
  updateBakedCssUrl(themeId: string, url: string | null): Promise<void>
  countSlottedByAuthorId(authorId: string): Promise<number>
  updateSlotStatus(themeId: string, isSlotted: boolean): Promise<Theme>
  findSlottedByAuthorId(authorId: string): Promise<Theme[]>
  unslotAllByAuthorId(authorId: string): Promise<void>
  findSystemThemes(): Promise<Theme[]>
  findSystemThemeByPreset(preset: string): Promise<Theme | null>
  /** 일일 생성 한도 체크용: 특정 시각 이후 생성된 테마 수 */
  countByAuthorIdSince(authorId: string, sources: string[], since: Date): Promise<number>
}
