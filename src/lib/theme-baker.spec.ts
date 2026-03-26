import { bakeThemeToCSS } from './theme-baker'

describe('bakeThemeToCSS', () => {
  it('테마 JSON을 CSS 변수로 변환한다', () => {
    const theme = {
      bgPrimary: '#0a0a0a',
      textPrimary: '#d4c5a0',
      accent: '#c8a96e',
    }
    const css = bakeThemeToCSS(theme, 'deerdevil')
    expect(css).toContain('--u-bg: #0a0a0a;')
    expect(css).toContain('--u-text: #d4c5a0;')
    expect(css).toContain('--u-accent: #c8a96e;')
    expect(css).toContain(':root {')
  })

  it('폰트를 풀네임으로 매핑한다', () => {
    const theme = { fontBody: 'serif', fontHeading: 'monospace' }
    const css = bakeThemeToCSS(theme, 'test')
    expect(css).toContain('EB Garamond')
    expect(css).toContain('JetBrains Mono')
  })

  it('작가 슬러그를 주석에 포함한다', () => {
    const css = bakeThemeToCSS({}, 'my-author')
    expect(css).toContain('Grimoire Theme: my-author')
  })

  it('빈 테마는 빈 :root를 생성한다', () => {
    const css = bakeThemeToCSS({}, 'empty')
    expect(css).toContain(':root {\n\n}')
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
    expect(css).toContain('--u-bg:')
    expect(css).toContain('--u-bg2:')
    expect(css).toContain('--u-text:')
    expect(css).toContain('--u-text-muted:')
    expect(css).toContain('--u-text-dim:')
    expect(css).toContain('--u-text-bright:')
    expect(css).toContain('--u-accent:')
    expect(css).toContain('--u-accent2:')
    expect(css).toContain('--u-border:')
  })

  it('알 수 없는 폰트는 원본 값 그대로 사용한다', () => {
    const theme = { fontBody: 'Pretendard', fontHeading: 'Arial' }
    const css = bakeThemeToCSS(theme, 'custom-font')
    expect(css).toContain('--u-font-body: Pretendard;')
    expect(css).toContain('--u-font-heading: Arial;')
  })
})
