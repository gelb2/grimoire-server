import { tryParseJSON, extractJSON, parseClaudeJSON } from './json-parser'

describe('json-parser', () => {
  describe('tryParseJSON', () => {
    it('유효한 JSON을 파싱한다', () => {
      const result = tryParseJSON<{ a: number }>('{"a": 1}')
      expect(result).toEqual({ a: 1 })
    })

    it('trailing comma를 제거하고 파싱한다', () => {
      const result = tryParseJSON<{ a: number }>('{"a": 1,}')
      expect(result).toEqual({ a: 1 })
    })

    it('배열 trailing comma도 처리한다', () => {
      const result = tryParseJSON<{ a: number[] }>('{"a": [1, 2,]}')
      expect(result).toEqual({ a: [1, 2] })
    })

    it('잘린 JSON을 복구한다', () => {
      const result = tryParseJSON<{ a: number }>('{"a": 1} extra text')
      expect(result).toEqual({ a: 1 })
    })

    it('파싱 불가능한 텍스트에서 에러를 던진다', () => {
      expect(() => tryParseJSON('not json at all')).toThrow('JSON 파싱 실패')
    })
  })

  describe('extractJSON', () => {
    it('텍스트에서 JSON 객체를 추출한다', () => {
      const result = extractJSON('Here is the theme: {"tone": "dark"} end')
      expect(result).toBe('{"tone": "dark"}')
    })

    it('마크다운 코드블록 안의 JSON을 추출한다', () => {
      const result = extractJSON('```json\n{"tone": "dark"}\n```')
      expect(result).toBe('{"tone": "dark"}')
    })

    it('JSON이 없으면 에러를 던진다', () => {
      expect(() => extractJSON('no json here')).toThrow('응답에서 JSON을 찾을 수 없습니다')
    })
  })

  describe('parseClaudeJSON', () => {
    it('Claude 응답에서 JSON을 추출하고 파싱한다', () => {
      const response = 'Here is the theme:\n{"bgPrimary": "#0a0a0a", "tone": "dark"}'
      const result = parseClaudeJSON<{ bgPrimary: string; tone: string }>(response)
      expect(result).toEqual({ bgPrimary: '#0a0a0a', tone: 'dark' })
    })

    it('trailing comma가 있는 Claude 응답도 파싱한다', () => {
      const response = '{"bgPrimary": "#0a0a0a", "tone": "dark",}'
      const result = parseClaudeJSON<{ bgPrimary: string; tone: string }>(response)
      expect(result).toEqual({ bgPrimary: '#0a0a0a', tone: 'dark' })
    })
  })
})
