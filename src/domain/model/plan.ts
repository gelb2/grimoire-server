import type { AuthorTheme, ThemeDecorations, Theme } from './theme'

/** 플랜 만기 여부 판단 — 순수 도메인 로직 */
export function isPlanExpired(plan: string, planExpireAt: Date | null): boolean {
  // free 플랜은 만기 없음
  if (plan === 'free') return false
  // 만기일 미설정 = 만기 없음
  if (!planExpireAt) return false
  // 만기일 경과 여부
  return planExpireAt < new Date()
}

/** 시스템 기본 테마 — 만기 시 폴백용 (Claude API로 생성한 중립 테마) */
const SYSTEM_DEFAULT_DECORATIONS: ThemeDecorations = {
  dividerIcon: 'dot',
  dividerColor: '#64748b',
  headerIcon: 'dot',
  headerSubtitle: 'GRIMOIRE LIBRARY',
  cardAccentPosition: 'left',
  footerText: '당신만의 이야기를 시작하세요',
}

const SYSTEM_DEFAULT_OVERRIDES: AuthorTheme = {
  bgPrimary: '#f8f7f5',
  bgSecondary: '#ffffff',
  textPrimary: '#1a1918',
  textMuted: '#6b6967',
  textDim: '#9a9894',
  textBright: '#000000',
  accent: '#475569',
  accent2: '#64748b',
  border: '#e2e0dd',
  fontBody: 'serif',
  fontHeading: 'serif',
  animation: 'fade',
  tone: 'light',
  episodeListLayout: 'grid',
  decorations: SYSTEM_DEFAULT_DECORATIONS,
  tagline: '모든 이야기가 시작되는 곳',
  titleSize: 'lg',
  titleWeight: 'bold',
  letterSpacing: 'normal',
  bodyLineHeight: 'relaxed',
  bodySize: 'normal',
  contentWidth: 'normal',
  heroStyle: 'minimal',
  tabPillRadius: '20px',
  labelLetterSpacing: '0.25em',
  cardRadius: '8px',
  cardWatermarkOpacity: 0.15,
  cardHoverLift: '0.125rem',
  cardCtaText: '읽기 →',
  navOpacity: 0.95,
  typingSpeed: 15,
  subtitleStyle: 'normal',
  episodeLabelFormat: '{author} · {type} {num}',
  sectionSpacing: 'md',
  showPreface: true,
  showAfterword: true,
}

export const SYSTEM_DEFAULT_THEME: Theme = {
  id: 'system-default',
  authorId: '',
  name: '시스템 기본 테마',
  preset: 'system-default',
  overrides: SYSTEM_DEFAULT_OVERRIDES,
  rawDescription: null,
  bakedCssUrl: null,
  isSlotted: false,
  source: 'system',
  updatedAt: new Date('2026-01-01'),
}
