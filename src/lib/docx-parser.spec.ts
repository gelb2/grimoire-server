import { parseDocx } from './docx-parser'
import * as mammoth from 'mammoth'

// mammoth를 모킹하여 실제 DOCX 파일 없이 테스트
jest.mock('mammoth', () => ({
  convertToHtml: jest.fn(),
}))

const mockConvertToHtml = mammoth.convertToHtml as jest.MockedFunction<
  typeof mammoth.convertToHtml
>

describe('parseDocx', () => {
  it('HTML 문단을 paragraph 블록으로 변환한다', async () => {
    mockConvertToHtml.mockResolvedValue({
      value: '<p>첫 번째 문단입니다.</p><p>두 번째 문단입니다.</p>',
      messages: [],
    })

    const result = await parseDocx(Buffer.from('dummy'))
    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0]).toEqual({ type: 'paragraph', text: '첫 번째 문단입니다.' })
    expect(result.blocks[1]).toEqual({ type: 'paragraph', text: '두 번째 문단입니다.' })
  })

  it('h1 태그를 heading-1 블록으로 변환한다 (MD 파서 정본 규격)', async () => {
    mockConvertToHtml.mockResolvedValue({
      value: '<h1>제 1장</h1><p>본문</p>',
      messages: [],
    })

    const result = await parseDocx(Buffer.from('dummy'))
    expect(result.blocks[0]).toEqual({ type: 'heading-1', title: '제 1장' })
    expect(result.blocks[1]).toEqual({ type: 'paragraph', text: '본문' })
  })

  it('hr 태그를 separator 블록으로 변환한다 (MD 파서 정본 규격)', async () => {
    mockConvertToHtml.mockResolvedValue({
      value: '<p>문단 1</p><hr><p>문단 2</p>',
      messages: [],
    })

    const result = await parseDocx(Buffer.from('dummy'))
    expect(result.blocks).toHaveLength(3)
    expect(result.blocks[1]).toEqual({ type: 'separator' })
  })

  it('이탤릭 전용 문단을 italic 블록으로 변환한다', async () => {
    mockConvertToHtml.mockResolvedValue({
      value: '<p><em>이탤릭 텍스트</em></p>',
      messages: [],
    })

    const result = await parseDocx(Buffer.from('dummy'))
    expect(result.blocks[0]).toEqual({ type: 'italic', text: '이탤릭 텍스트' })
  })

  it('HTML 엔티티를 디코딩한다', async () => {
    mockConvertToHtml.mockResolvedValue({
      value: '<p>A &amp; B &lt;C&gt; &quot;D&quot;</p>',
      messages: [],
    })

    const result = await parseDocx(Buffer.from('dummy'))
    expect(result.blocks[0]).toEqual({ type: 'paragraph', text: 'A & B <C> "D"' })
  })

  it('빈 HTML은 빈 블록을 반환한다', async () => {
    mockConvertToHtml.mockResolvedValue({
      value: '',
      messages: [],
    })

    const result = await parseDocx(Buffer.from('dummy'))
    expect(result.blocks).toHaveLength(0)
  })

  it('metadata로 frontmatter를 생성한다', async () => {
    mockConvertToHtml.mockResolvedValue({
      value: '<p>내용</p>',
      messages: [],
    })

    const result = await parseDocx(Buffer.from('dummy'), { title: 'My Novel', subtitle: '부제' })
    expect(result.frontmatter.slug).toBe('my-novel')
    expect(result.frontmatter.subtitle).toBe('부제')
  })
})
