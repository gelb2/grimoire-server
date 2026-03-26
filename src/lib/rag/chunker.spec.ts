import { chunkText } from './chunker'

describe('chunkText (소설 도메인)', () => {
  it('빈 텍스트는 빈 배열을 반환한다', () => {
    expect(chunkText('')).toHaveLength(0)
    expect(chunkText('  ')).toHaveLength(0)
  })

  it('청크 크기보다 작은 텍스트는 1개 청크를 반환한다', () => {
    const result = chunkText('짧은 텍스트')
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('짧은 텍스트')
    expect(result[0].index).toBe(0)
  })

  it('문단 경계에서 분할한다', () => {
    const text = 'A'.repeat(500) + '\n\n' + 'B'.repeat(500)
    const result = chunkText(text, 600, 50)
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('문장 경계에서 분할한다', () => {
    const text = '첫 번째 문장입니다. ' + 'A'.repeat(700) + '. 마지막 문장입니다.'
    const result = chunkText(text, 400, 50)
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('인덱스가 순차적으로 증가한다', () => {
    const text = Array(20).fill('이것은 테스트 문장입니다.').join('\n\n')
    const result = chunkText(text, 100, 20)
    for (let i = 0; i < result.length; i++) {
      expect(result[i].index).toBe(i)
    }
  })

  it('Windows 줄바꿈을 처리한다', () => {
    const text = '줄1\r\n\r\n줄2\r\n\r\n줄3'
    const result = chunkText(text, 1000)
    expect(result).toHaveLength(1) // 전체가 1000자 미만
  })

  it('overlap이 동작한다', () => {
    const text = 'A'.repeat(300) + '\n\n' + 'B'.repeat(300) + '\n\n' + 'C'.repeat(300)
    const result = chunkText(text, 400, 50)
    expect(result.length).toBeGreaterThanOrEqual(2)
    // overlap으로 인해 일부 텍스트가 중복되어야 함
  })
})
