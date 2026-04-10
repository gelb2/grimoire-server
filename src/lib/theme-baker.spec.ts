import { bakeThemeToCSS, sanitizeCssValue } from './theme-baker'

describe('bakeThemeToCSS', () => {
  it('테마 JSON을 CSS 변수로 변환한다', () => {
    const theme = {
      bgPrimary: '#0a0a0a',
      textPrimary: '#d4c5a0',
      accent: '#c8a96e',
    }
    const css = bakeThemeToCSS(theme, 'deerdevil')
    expect(css).toContain('--g-bg: #0a0a0a;')
    expect(css).toContain('--g-text: #d4c5a0;')
    expect(css).toContain('--g-accent: #c8a96e;')
    expect(css).toContain(':root {')
  })

  it('폰트를 풀네임으로 매핑한다', () => {
    const theme = { fontBody: 'serif', fontHeading: 'monospace' }
    const css = bakeThemeToCSS(theme, 'test')
    expect(css).toContain('--g-serif:')
    expect(css).toContain('--g-heading-font:')
    expect(css).toContain('JetBrains Mono')
  })

  it('작가 슬러그를 주석에 포함한다', () => {
    const css = bakeThemeToCSS({}, 'my-author')
    expect(css).toContain('Grimoire Theme: my-author')
  })

  it('빈 테마도 기본 변수를 포함한 :root를 생성한다', () => {
    const css = bakeThemeToCSS({}, 'empty')
    expect(css).toContain(':root {')
    expect(css).toContain('--g-sans:')
    expect(css).toContain('color-scheme:')
  })

  it('모든 색상 속성을 매핑한다', () => {
    const theme = {
      bgPrimary: '#111',
      bgSecondary: '#222',
      textPrimary: '#333',
      textMuted: '#444',
      textDim: '#555',
      textBright: '#666',
      accent: '#777',
      accent2: '#888',
      border: '#999',
    }
    const css = bakeThemeToCSS(theme, 'full')
    expect(css).toContain('--g-bg:')
    expect(css).toContain('--g-bg2:')
    expect(css).toContain('--g-text:')
    expect(css).toContain('--g-text-muted:')
    expect(css).toContain('--g-text-dim:')
    expect(css).toContain('--g-text-bright:')
    expect(css).toContain('--g-accent:')
    expect(css).toContain('--g-accent2:')
    expect(css).toContain('--g-border:')
  })

  it('허용되지 않은 폰트는 무시한다 (인젝션 방지)', () => {
    const theme = { fontBody: 'Pretendard', fontHeading: 'Arial' }
    const css = bakeThemeToCSS(theme, 'custom-font')
    expect(css).not.toContain('Pretendard')
    expect(css).not.toContain('Arial')
  })

  it('CSS 인젝션 공격을 차단한다', () => {
    const theme = {
      bgPrimary: '#0a0a0a; } body { background: red',
      textPrimary: 'expression(alert(1))',
      accent: 'url(javascript:alert(1))',
    }
    const css = bakeThemeToCSS(theme, 'attacker')
    expect(css).not.toContain('expression')
    expect(css).not.toContain('javascript')
    expect(css).not.toContain('alert')
    expect(css).not.toContain('background: red')
  })
})

describe('sanitizeCssValue', () => {
  it('유효한 hex 색상을 허용한다', () => {
    expect(sanitizeCssValue('#fff')).toBe('#fff')
    expect(sanitizeCssValue('#0a0a0a')).toBe('#0a0a0a')
    expect(sanitizeCssValue('#FF00FF')).toBe('#FF00FF')
  })

  it('유효한 rgb/hsl 색상을 허용한다', () => {
    expect(sanitizeCssValue('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)')
    expect(sanitizeCssValue('hsl(120, 50%, 50%)')).toBe('hsl(120, 50%, 50%)')
  })

  it('명명된 색상을 허용한다', () => {
    expect(sanitizeCssValue('red')).toBe('red')
    expect(sanitizeCssValue('transparent')).toBe('transparent')
  })

  it('세미콜론이 포함된 값을 차단한다', () => {
    expect(sanitizeCssValue('#fff; } body { display: none')).toBeNull()
  })

  it('url()을 차단한다', () => {
    expect(sanitizeCssValue('url(http://evil.com)')).toBeNull()
  })

  it('expression()을 차단한다', () => {
    expect(sanitizeCssValue('expression(alert(1))')).toBeNull()
  })

  it('javascript:를 차단한다', () => {
    expect(sanitizeCssValue('javascript:alert(1)')).toBeNull()
  })
})
