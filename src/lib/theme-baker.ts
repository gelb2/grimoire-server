/**
 * CSS 값 인젝션 방지를 위한 허용 패턴
 * hex 색상, rgb(), hsl(), 명명된 색상만 허용
 */
const SAFE_CSS_COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*[\d.]+\s*\)|hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)|hsla\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*,\s*[\d.]+\s*\))$/

const NAMED_COLORS = new Set([
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta',
  'gray', 'grey', 'orange', 'purple', 'pink', 'brown', 'navy', 'teal',
  'maroon', 'olive', 'lime', 'aqua', 'fuchsia', 'silver', 'transparent',
  'inherit', 'currentcolor',
])

/**
 * CSS 값 새니타이제이션 — 인젝션 공격 방지
 * 허용: hex (#xxx, #xxxxxx), rgb(), hsl(), 명명된 색상
 * 차단: ;, {, }, url(), expression(), javascript:
 */
export function sanitizeCssValue(value: string): string | null {
  if (!value || typeof value !== 'string') return null

  const trimmed = value.trim().toLowerCase()

  // 위험 패턴 감지
  if (/[;{}]/.test(trimmed)) return null
  if (/url\s*\(/.test(trimmed)) return null
  if (/expression\s*\(/.test(trimmed)) return null
  if (/javascript\s*:/.test(trimmed)) return null
  if (/import\s/.test(trimmed)) return null
  if (/@/.test(trimmed)) return null

  // 명명된 색상 확인
  if (NAMED_COLORS.has(trimmed)) return value.trim()

  // 패턴 매칭 (원본 값 반환, 소문자화하지 않음)
  if (SAFE_CSS_COLOR_PATTERN.test(value.trim())) return value.trim()

  return null
}

/** 안전한 CSS 문자열 값 (인젝션 차단, 허용된 값만 통과) */
function safeCssString(value: string | undefined, allowed: Record<string, string>): string | null {
  if (!value) return null
  return allowed[value] ?? null
}

/**
 * 테마 JSON을 CSS 문자열로 변환 (Baking)
 * CSS 변수명은 프론트엔드 ThemeProvider와 일치 (--g-* 접두사)
 */
export function bakeThemeToCSS(
  theme: Record<string, any>,
  authorSlug: string,
): string {
  const cssVars: string[] = []

  // 색상 매핑 (새니타이즈 적용) — --g-* 접두사 (프론트엔드 일치)
  const colorFields: [string, string][] = [
    ['bgPrimary', '--g-bg'],
    ['bgSecondary', '--g-bg2'],
    ['textPrimary', '--g-text'],
    ['textMuted', '--g-text-muted'],
    ['textDim', '--g-text-dim'],
    ['textBright', '--g-text-bright'],
    ['accent', '--g-accent'],
    ['accent2', '--g-accent2'],
    ['border', '--g-border'],
  ]

  for (const [field, cssVar] of colorFields) {
    if (theme[field]) {
      const safe = sanitizeCssValue(theme[field])
      if (safe) {
        cssVars.push(`  ${cssVar}: ${safe};`)
      }
    }
  }

  // accent2를 --g-text-warm으로도 매핑 (프론트엔드 호환)
  if (theme.accent2) {
    const safe = sanitizeCssValue(theme.accent2)
    if (safe) cssVars.push(`  --g-text-warm: ${safe};`)
  }

  // 폰트 매핑
  const fontMap: Record<string, string> = {
    serif: "var(--fn-garamond), var(--fn-noto-serif-kr), Georgia, 'Batang', serif",
    'sans-serif': 'system-ui, -apple-system, sans-serif',
    monospace: "'JetBrains Mono', 'Fira Code', monospace",
  }
  if (theme.fontBody) {
    const mapped = fontMap[theme.fontBody]
    if (mapped) cssVars.push(`  --g-serif: ${mapped};`)
  }
  cssVars.push(`  --g-sans: ${fontMap['sans-serif']};`)
  if (theme.fontHeading) {
    const mapped = fontMap[theme.fontHeading]
    if (mapped) cssVars.push(`  --g-heading-font: ${mapped};`)
  }

  // Phase 1 타이포그래피 확장
  const titleSizeMap: Record<string, string> = { sm: '2rem', md: '3rem', lg: '4rem', xl: '6rem' }
  const titleWeightMap: Record<string, string> = { light: '300', normal: '400', bold: '700', black: '900' }
  const letterSpacingMap: Record<string, string> = { tight: '-0.02em', normal: '0', wide: '0.1em' }
  const lineHeightMap: Record<string, string> = { compact: '1.5', normal: '1.7', relaxed: '1.9' }
  const contentWidthMap: Record<string, string> = { narrow: '600px', normal: '700px', wide: '860px' }
  const bodySizeMap: Record<string, string> = { compact: '16px', normal: '19px', large: '21px' }

  const titleSize = safeCssString(theme.titleSize, titleSizeMap)
  if (titleSize) cssVars.push(`  --g-title-size: ${titleSize};`)

  const titleWeight = safeCssString(theme.titleWeight, titleWeightMap)
  if (titleWeight) cssVars.push(`  --g-title-weight: ${titleWeight};`)

  const letterSpacing = safeCssString(theme.letterSpacing, letterSpacingMap)
  if (letterSpacing) cssVars.push(`  --g-letter-spacing: ${letterSpacing};`)

  const lineHeight = safeCssString(theme.bodyLineHeight, lineHeightMap)
  if (lineHeight) cssVars.push(`  --g-line-height: ${lineHeight};`)

  const contentWidth = safeCssString(theme.contentWidth, contentWidthMap)
  if (contentWidth) cssVars.push(`  --g-content-width: ${contentWidth};`)

  const bodySize = safeCssString(theme.bodySize, bodySizeMap)
  if (bodySize) cssVars.push(`  --g-body-size: ${bodySize};`)

  // 카드/네비 토큰
  if (theme.cardRadius) cssVars.push(`  --g-card-radius: ${theme.cardRadius};`)
  if (theme.navOpacity != null) cssVars.push(`  --g-nav-opacity: ${theme.navOpacity};`)
  if (theme.tabPillRadius) cssVars.push(`  --g-tab-pill-radius: ${theme.tabPillRadius};`)
  if (theme.labelLetterSpacing) cssVars.push(`  --g-label-letter-spacing: ${theme.labelLetterSpacing};`)
  if (theme.cardWatermarkOpacity != null) cssVars.push(`  --g-card-watermark-opacity: ${theme.cardWatermarkOpacity};`)
  if (theme.cardHoverLift) cssVars.push(`  --g-card-hover-lift: ${theme.cardHoverLift};`)

  // tone → color-scheme
  if (theme.tone === 'light') {
    cssVars.push(`  color-scheme: light;`)
  } else {
    cssVars.push(`  color-scheme: dark;`)
  }

  // authorSlug 새니타이즈 (CSS 주석 인젝션 방지)
  const safeSlug = authorSlug.replace(/[^a-zA-Z0-9_-]/g, '')
  const comment = `/* Grimoire Theme: ${safeSlug} — Generated at ${new Date().toISOString()} */`
  return `${comment}\n:root {\n${cssVars.join('\n')}\n}\n`
}
