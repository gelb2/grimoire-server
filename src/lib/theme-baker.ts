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

/**
 * 테마 JSON을 CSS 문자열로 변환 (Baking)
 * 작가가 테마를 퍼블리시할 때 호출되어 정적 CSS 파일을 생성한다
 */
export function bakeThemeToCSS(
  theme: Record<string, any>,
  authorSlug: string,
): string {
  const cssVars: string[] = []

  // 색상 매핑 (새니타이즈 적용)
  const colorFields: [string, string][] = [
    ['bgPrimary', '--u-bg'],
    ['bgSecondary', '--u-bg2'],
    ['textPrimary', '--u-text'],
    ['textMuted', '--u-text-muted'],
    ['textDim', '--u-text-dim'],
    ['textBright', '--u-text-bright'],
    ['accent', '--u-accent'],
    ['accent2', '--u-accent2'],
    ['border', '--u-border'],
  ]

  for (const [field, cssVar] of colorFields) {
    if (theme[field]) {
      const safe = sanitizeCssValue(theme[field])
      if (safe) {
        cssVars.push(`  ${cssVar}: ${safe};`)
      }
    }
  }

  // 폰트 매핑 (허용된 폰트맵에서만 선택, 커스텀 폰트값은 새니타이즈)
  const fontMap: Record<string, string> = {
    serif: '"EB Garamond", "Noto Serif KR", serif',
    'sans-serif': '"Noto Sans KR", sans-serif',
    monospace: '"JetBrains Mono", monospace',
  }
  if (theme.fontBody) {
    const mapped = fontMap[theme.fontBody]
    if (mapped) {
      cssVars.push(`  --u-serif: ${mapped};`)
    }
    // 허용된 폰트맵에 없는 값은 무시 (인젝션 방지)
  }
  if (theme.fontHeading) {
    const mapped = fontMap[theme.fontHeading]
    if (mapped) {
      cssVars.push(`  --u-sans: ${mapped};`)
    }
  }

  // authorSlug도 새니타이즈 (CSS 주석 인젝션 방지)
  const safeSlug = authorSlug.replace(/[^a-zA-Z0-9_-]/g, '')
  const comment = `/* Grimoire Theme: ${safeSlug} — Generated at ${new Date().toISOString()} */`
  return `${comment}\n:root {\n${cssVars.join('\n')}\n}\n`
}
