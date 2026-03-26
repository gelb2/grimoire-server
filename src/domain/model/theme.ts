/**
 * Claude API가 생성하는 테마 JSON 스키마
 * docs/theme-spec.md 참조
 */
export interface AuthorTheme {
  bgPrimary: string
  bgSecondary: string
  textPrimary: string
  textMuted: string
  textBright: string
  textDim: string
  accent: string
  accent2: string
  border: string

  fontBody: 'serif' | 'sans-serif' | 'monospace' | 'handwriting'
  fontHeading: 'serif' | 'sans-serif' | 'monospace' | 'handwriting'
  fontSize: 'compact' | 'normal' | 'large'

  animation: 'typing' | 'fade' | 'slide' | 'none'
  cardStyle: 'sharp' | 'rounded' | 'minimal'
  tone: 'dark' | 'light' | 'sepia' | 'custom'
}

/** DB에 저장되는 테마 엔티티 */
export interface Theme {
  id: string
  authorId: string
  preset: string
  overrides: AuthorTheme | null
  rawDescription: string | null
  bakedCssUrl: string | null
  updatedAt: Date
}
