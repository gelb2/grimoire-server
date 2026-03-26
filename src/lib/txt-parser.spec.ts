import { parseTxt, detectFormat } from './txt-parser'

describe('parseTxt', () => {
  it('빈 줄로 문단을 분리한다', () => {
    const input = '첫 번째 문단입니다.\n\n두 번째 문단입니다.'
    const result = parseTxt(input)
    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0]).toEqual({ type: 'paragraph', text: '첫 번째 문단입니다.' })
    expect(result.blocks[1]).toEqual({ type: 'paragraph', text: '두 번째 문단입니다.' })
  })

  it('구분선(---)을 인식한다', () => {
    const input = '문단 1\n\n---\n\n문단 2'
    const result = parseTxt(input)
    expect(result.blocks).toHaveLength(3)
    expect(result.blocks[1]).toEqual({ type: 'divider' })
  })

  it('연속된 줄은 하나의 문단으로 합친다', () => {
    const input = '줄 하나\n줄 둘\n줄 셋'
    const result = parseTxt(input)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0]).toEqual({ type: 'paragraph', text: '줄 하나 줄 둘 줄 셋' })
  })

  it('빈 입력은 빈 블록을 반환한다', () => {
    const result = parseTxt('')
    expect(result.blocks).toHaveLength(0)
  })

  it('metadata로 frontmatter를 생성한다', () => {
    const result = parseTxt('내용', { title: 'Test Title', subtitle: '부제' })
    expect(result.frontmatter.slug).toBe('test-title')
    expect(result.frontmatter.subtitle).toBe('부제')
  })

  it('Windows 줄바꿈(\\r\\n)을 처리한다', () => {
    const input = '첫 줄\r\n\r\n둘째 줄'
    const result = parseTxt(input)
    expect(result.blocks).toHaveLength(2)
  })
})

describe('detectFormat', () => {
  it('마크다운 frontmatter를 감지한다', () => {
    expect(detectFormat('---\ntitle: test\n---\n# Hello')).toBe('markdown')
  })

  it('마크다운 헤더를 감지한다', () => {
    expect(detectFormat('# 제목')).toBe('markdown')
  })

  it('HTML 태그를 감지한다', () => {
    expect(detectFormat('<div>Hello</div>')).toBe('html')
  })

  it('일반 텍스트를 감지한다', () => {
    expect(detectFormat('그냥 평범한 텍스트입니다.\n\n다음 문단.')).toBe('txt')
  })

  it('마크다운 링크를 감지한다', () => {
    expect(detectFormat('이것은 [링크](url)입니다')).toBe('markdown')
  })
})
