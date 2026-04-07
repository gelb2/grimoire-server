/**
 * Claude API가 생성하는 테마 JSON 스키마
 * docs/theme-spec.md 참조
 * ⚠ grimoire-web/src/features/theme/presets.ts의 AuthorTheme과 동기화 필수
 */

/** 장식 요소 */
export interface ThemeDecorations {
  dividerIcon: 'antler' | 'flower' | 'star' | 'geometric' | 'brush' | 'leaf' | 'camellia' | 'umbrella' | 'waterwheel' | 'book' | 'dot' | 'line' | 'none'
  dividerColor: string
  headerIcon: 'antler' | 'quill' | 'book' | 'dot' | 'none'
  headerSubtitle: string
  cardAccentPosition: 'left' | 'top' | 'none'
  footerText: string
}

export interface AuthorTheme {
  // ── 색상 (9개, 필수) ──
  bgPrimary: string
  bgSecondary: string
  textPrimary: string
  textMuted: string
  textDim: string
  textBright: string
  accent: string
  accent2: string
  border: string

  // ── 타이포그래피 (필수) ──
  fontBody: 'serif' | 'sans-serif' | 'monospace'
  fontHeading: 'serif' | 'sans-serif' | 'monospace'

  // ── 분위기 (필수) ──
  animation: 'typing' | 'fade' | 'slide' | 'none'
  tone: 'dark' | 'light' | 'sepia'

  // ── 레이아웃 (필수) ──
  episodeListLayout: 'series' | 'grid' | 'classic' | 'magazine' | 'gallery' | 'minimal'

  // ── 장식 (필수) ──
  decorations: ThemeDecorations

  // ── 작가 문구 ──
  tagline?: string

  // ── Phase 1 타이포그래피 ──
  titleSize?: 'sm' | 'md' | 'lg' | 'xl'
  titleWeight?: 'light' | 'normal' | 'bold' | 'black'
  letterSpacing?: 'tight' | 'normal' | 'wide'
  bodyLineHeight?: 'compact' | 'normal' | 'relaxed'
  bodySize?: 'compact' | 'normal' | 'large'
  contentWidth?: 'narrow' | 'normal' | 'wide'

  // ── Phase 2 레이아웃 ──
  heroStyle?: 'fullname' | 'cover' | 'minimal' | 'none'

  // ── 네비/탭 ──
  tabPillRadius?: string
  labelLetterSpacing?: string

  // ── 에피소드 카드 ──
  cardRadius?: string
  cardWatermarkOpacity?: number
  cardHoverLift?: string
  cardCtaText?: string

  // ── 에피소드 뷰어 ──
  subtitleStyle?: 'italic' | 'normal'
  episodeLabelFormat?: string

  // ── 여백/섹션 ──
  sectionSpacing?: 'sm' | 'md' | 'lg'
  showPreface?: boolean
  showAfterword?: boolean

  // ── 네비게이션 ──
  navOpacity?: number
  showProfileTab?: boolean
  subscribeButtonStyle?: 'outlined' | 'filled'

  // ── 애니메이션 세부 ──
  typingSpeed?: number
}

/** DB에 저장되는 테마 엔티티 */
export interface Theme {
  id: string
  authorId: string | null
  name: string
  preset: string
  overrides: AuthorTheme | null
  rawDescription: string | null
  bakedCssUrl: string | null
  isSlotted: boolean
  source: 'system' | 'ai' | 'user'
  updatedAt: Date
}
