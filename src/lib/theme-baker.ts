/**
 * 테마 JSON을 CSS 문자열로 변환 (Baking)
 * 작가가 테마를 퍼블리시할 때 호출되어 정적 CSS 파일을 생성한다
 */
export function bakeThemeToCSS(
  theme: Record<string, any>,
  authorSlug: string,
): string {
  const cssVars: string[] = []

  // 색상 매핑
  if (theme.bgPrimary) cssVars.push(`  --u-bg: ${theme.bgPrimary};`)
  if (theme.bgSecondary) cssVars.push(`  --u-bg2: ${theme.bgSecondary};`)
  if (theme.textPrimary) cssVars.push(`  --u-text: ${theme.textPrimary};`)
  if (theme.textMuted) cssVars.push(`  --u-text-muted: ${theme.textMuted};`)
  if (theme.textDim) cssVars.push(`  --u-text-dim: ${theme.textDim};`)
  if (theme.textBright)
    cssVars.push(`  --u-text-bright: ${theme.textBright};`)
  if (theme.accent) cssVars.push(`  --u-accent: ${theme.accent};`)
  if (theme.accent2) cssVars.push(`  --u-accent2: ${theme.accent2};`)
  if (theme.border) cssVars.push(`  --u-border: ${theme.border};`)

  // 폰트 매핑
  const fontMap: Record<string, string> = {
    serif: '"EB Garamond", "Noto Serif KR", serif',
    'sans-serif': '"Noto Sans KR", sans-serif',
    monospace: '"JetBrains Mono", monospace',
  }
  if (theme.fontBody) {
    cssVars.push(
      `  --u-serif: ${fontMap[theme.fontBody] || theme.fontBody};`,
    )
  }
  if (theme.fontHeading) {
    cssVars.push(
      `  --u-sans: ${fontMap[theme.fontHeading] || theme.fontHeading};`,
    )
  }

  const comment = `/* Grimoire Theme: ${authorSlug} — Generated at ${new Date().toISOString()} */`
  return `${comment}\n:root {\n${cssVars.join('\n')}\n}\n`
}
