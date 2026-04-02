/**
 * 테마 프리셋 정의 — 프론트엔드 presets.ts와 동일한 값
 * API가 preset + overrides를 merge해서 완전한 테마를 내려줄 때 사용
 */

const defaultDecorations = {
  dividerIcon: 'dot',
  dividerColor: '',
  headerIcon: 'none',
  headerSubtitle: '',
  cardAccentPosition: 'left',
  footerText: '',
}

const defaultTypography = {
  titleSize: 'lg',
  titleWeight: 'bold',
  letterSpacing: 'normal',
  bodyLineHeight: 'relaxed',
  bodySize: 'normal',
  contentWidth: 'normal',
  heroStyle: 'minimal',
}

const defaultUI = {
  tabPillRadius: '20px',
  labelLetterSpacing: '0.25em',
  cardWatermarkOpacity: 0.15,
  cardHoverLift: '0.125rem',
  cardCtaText: '읽기 →',
  subtitleStyle: 'italic',
  episodeLabelFormat: '{author} · {type} {num}',
  sectionSpacing: 'md',
  showPreface: true,
  showAfterword: true,
  showProfileTab: true,
  subscribeButtonStyle: 'outlined',
}

const midnight = {
  bgPrimary: '#07070a',
  bgSecondary: '#0d0d12',
  textPrimary: '#cdc8bc',
  textMuted: '#7a7570',
  textDim: '#4a4740',
  textBright: '#e8e3d8',
  accent: '#9a8060',
  accent2: '#c4a46a',
  border: '#1e1e26',
  fontBody: 'serif',
  fontHeading: 'serif',
  animation: 'typing',
  tone: 'dark',
  episodeListLayout: 'series',
  decorations: {
    dividerIcon: 'antler',
    dividerColor: '#9a8060',
    headerIcon: 'antler',
    headerSubtitle: 'Short Fiction Anthology',
    cardAccentPosition: 'left',
    footerText: 'Inspired by the sensibility of A24',
  },
  ...defaultTypography,
  ...defaultUI,
}

const parchment = {
  bgPrimary: '#f5f0e8',
  bgSecondary: '#ebe5d8',
  textPrimary: '#3d3529',
  textMuted: '#8a7e6b',
  textDim: '#b5a992',
  textBright: '#1a1510',
  accent: '#8b6914',
  accent2: '#a67c1a',
  border: '#d5cbb8',
  fontBody: 'serif',
  fontHeading: 'serif',
  animation: 'fade',
  tone: 'sepia',
  episodeListLayout: 'grid',
  decorations: defaultDecorations,
  ...defaultTypography,
  ...defaultUI,
}

const morning = {
  bgPrimary: '#ffffff',
  bgSecondary: '#f8f8fa',
  textPrimary: '#1a1a1a',
  textMuted: '#6b7280',
  textDim: '#9ca3af',
  textBright: '#000000',
  accent: '#2563eb',
  accent2: '#3b82f6',
  border: '#e5e7eb',
  fontBody: 'sans-serif',
  fontHeading: 'sans-serif',
  animation: 'slide',
  tone: 'light',
  episodeListLayout: 'grid',
  decorations: defaultDecorations,
  ...defaultTypography,
  ...defaultUI,
}

const neon = {
  bgPrimary: '#0d0d0d',
  bgSecondary: '#1a1a2e',
  textPrimary: '#e0e0e0',
  textMuted: '#888899',
  textDim: '#555566',
  textBright: '#ffffff',
  accent: '#00ff88',
  accent2: '#00cc6a',
  border: '#2a2a3e',
  fontBody: 'monospace',
  fontHeading: 'monospace',
  animation: 'none',
  tone: 'dark',
  episodeListLayout: 'grid',
  decorations: defaultDecorations,
  ...defaultTypography,
  ...defaultUI,
  titleWeight: 'light',
  letterSpacing: 'wide',
}

const cream = {
  bgPrimary: '#faf8f5',
  bgSecondary: '#f0ede8',
  textPrimary: '#4a4035',
  textMuted: '#8a7e70',
  textDim: '#b5aa9a',
  textBright: '#2a2018',
  accent: '#c4956a',
  accent2: '#d4a57a',
  border: '#e0d8cc',
  fontBody: 'serif',
  fontHeading: 'sans-serif',
  animation: 'none',
  tone: 'light',
  episodeListLayout: 'grid',
  decorations: defaultDecorations,
  ...defaultTypography,
  ...defaultUI,
  bodyLineHeight: 'relaxed',
  contentWidth: 'narrow',
}

const magazine = {
  bgPrimary: '#ffffff',
  bgSecondary: '#f5f5f0',
  textPrimary: '#1a1a1a',
  textMuted: '#666666',
  textDim: '#999999',
  textBright: '#000000',
  accent: '#ff3333',
  accent2: '#cc0000',
  border: '#e0e0e0',
  fontBody: 'serif',
  fontHeading: 'sans-serif',
  animation: 'fade',
  tone: 'light',
  episodeListLayout: 'magazine',
  decorations: { ...defaultDecorations, cardAccentPosition: 'none' },
  titleSize: 'xl',
  titleWeight: 'black',
  letterSpacing: 'tight',
  bodyLineHeight: 'relaxed',
  contentWidth: 'wide',
  heroStyle: 'fullname',
  ...defaultUI,
}

const gallery = {
  bgPrimary: '#0a0a0a',
  bgSecondary: '#141414',
  textPrimary: '#e0e0e0',
  textMuted: '#808080',
  textDim: '#4a4a4a',
  textBright: '#ffffff',
  accent: '#ff4444',
  accent2: '#ff6666',
  border: '#2a2a2a',
  fontBody: 'sans-serif',
  fontHeading: 'sans-serif',
  animation: 'fade',
  tone: 'dark',
  episodeListLayout: 'gallery',
  decorations: { ...defaultDecorations, headerSubtitle: '', cardAccentPosition: 'none' },
  titleSize: 'xl',
  titleWeight: 'black',
  letterSpacing: 'wide',
  bodyLineHeight: 'normal',
  contentWidth: 'wide',
  heroStyle: 'fullname',
  ...defaultUI,
}

const minimal = {
  bgPrimary: '#111111',
  bgSecondary: '#1a1a1a',
  textPrimary: '#d4d0c8',
  textMuted: '#8a8680',
  textDim: '#5a5650',
  textBright: '#f0ece4',
  accent: '#d4a46a',
  accent2: '#e4b47a',
  border: '#2a2a2a',
  fontBody: 'serif',
  fontHeading: 'serif',
  animation: 'none',
  tone: 'dark',
  episodeListLayout: 'minimal',
  decorations: { ...defaultDecorations, dividerIcon: 'none', headerIcon: 'none', cardAccentPosition: 'none' },
  titleSize: 'lg',
  titleWeight: 'light',
  letterSpacing: 'wide',
  bodyLineHeight: 'relaxed',
  contentWidth: 'narrow',
  heroStyle: 'cover',
  ...defaultUI,
}

/** 프리셋 맵 — preset 이름으로 기본값 조회 */
export const themePresets: Record<string, Record<string, unknown>> = {
  midnight,
  deerDevil: midnight,
  parchment,
  morning,
  neon,
  cream,
  magazine,
  gallery,
  minimal,
}

/**
 * preset 기본값 + overrides를 merge한 완전한 테마 객체 반환
 * overrides가 우선, preset이 베이스
 */
/** 하위 호환: layout → episodeListLayout 매핑 */
function normalizeOverrides(overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...overrides }
  // layout → episodeListLayout 하위 호환
  if (result.layout && !result.episodeListLayout) {
    result.episodeListLayout = result.layout
  }
  // navStyle 제거 (삭제된 필드)
  delete result.navStyle
  return result
}

export function resolveTheme(preset: string, overrides: Record<string, unknown> | null): Record<string, unknown> {
  const normalized = overrides ? normalizeOverrides(overrides) : null

  // custom preset: overrides가 곧 테마. 누락 필드는 defaultTypography/defaultUI로만 보완.
  if (preset === 'custom') {
    if (!normalized || Object.keys(normalized).length === 0) return { ...themePresets['midnight'] }
    const baseDecorations = (normalized.decorations ?? defaultDecorations) as Record<string, unknown>
    return { ...defaultTypography, ...defaultUI, decorations: { ...defaultDecorations, ...baseDecorations }, ...normalized }
  }

  // 프리셋 preset: preset 기본값을 베이스로, overrides로 덮어쓰기.
  const base = themePresets[preset] ?? themePresets['midnight']
  if (!normalized || Object.keys(normalized).length === 0) return { ...base }

  const baseDecorations = (base.decorations ?? defaultDecorations) as Record<string, unknown>
  const overrideDecorations = (normalized.decorations ?? {}) as Record<string, unknown>

  return {
    ...base,
    ...normalized,
    decorations: { ...baseDecorations, ...overrideDecorations },
  }
}
