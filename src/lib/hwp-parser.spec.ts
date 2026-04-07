import { parseHwp, parseHwpx } from './hwp-parser'
import * as JSZip from 'jszip'

// @ohah/hwpjs 모킹 — 실제 HWP 바이너리 파일 없이 테스트
jest.mock('@ohah/hwpjs', () => ({
  toMarkdown: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toMarkdown } = require('@ohah/hwpjs')
const mockToMarkdown = toMarkdown as jest.MockedFunction<typeof toMarkdown>

// ── HWPX 테스트 헬퍼: 최소 HWPX ZIP 생성 ──

async function createHwpxBuffer(sectionXml: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('Contents/section0.xml', sectionXml)
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}

// ── parseHwp 테스트 ──

describe('parseHwp', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('마크다운 출력에서 paragraph 블록을 추출한다', async () => {
    mockToMarkdown.mockReturnValue({
      markdown: '첫 번째 문단입니다.\n\n두 번째 문단입니다.',
      images: [],
    })

    const result = await parseHwp(Buffer.from('dummy'))
    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0]).toEqual({ type: 'paragraph', text: '첫 번째 문단입니다.' })
    expect(result.blocks[1]).toEqual({ type: 'paragraph', text: '두 번째 문단입니다.' })
  })

  it('마크다운 헤딩을 heading/chapter 블록으로 변환한다', async () => {
    mockToMarkdown.mockReturnValue({
      markdown: '# 제목\n\n## 부제\n\n### 1. 첫 번째 장\n\n본문',
      images: [],
    })

    const result = await parseHwp(Buffer.from('dummy'))
    expect(result.blocks[0]).toEqual({ type: 'heading-1', title: '제목' })
    expect(result.blocks[1]).toEqual({ type: 'heading-2', title: '부제' })
    expect(result.blocks[2]).toEqual({ type: 'chapter', num: '1', title: '첫 번째 장' })
    expect(result.blocks[3]).toEqual({ type: 'paragraph', text: '본문' })
  })

  it('구분선을 divider 블록으로 변환한다', async () => {
    mockToMarkdown.mockReturnValue({
      markdown: '문단 1\n\n---\n\n문단 2',
      images: [],
    })

    const result = await parseHwp(Buffer.from('dummy'))
    expect(result.blocks).toHaveLength(3)
    expect(result.blocks[1]).toEqual({ type: 'divider' })
  })

  it('볼드/이탤릭 전용 문단을 감지한다', async () => {
    mockToMarkdown.mockReturnValue({
      markdown: '**굵은 텍스트**\n\n*기울임 텍스트*',
      images: [],
    })

    const result = await parseHwp(Buffer.from('dummy'))
    expect(result.blocks[0]).toEqual({ type: 'bold', text: '굵은 텍스트' })
    expect(result.blocks[1]).toEqual({ type: 'italic', text: '기울임 텍스트' })
  })

  it('빈 마크다운 출력 시 에러를 던진다 (HWPX 권장 메시지 포함)', async () => {
    mockToMarkdown.mockReturnValue({ markdown: '', images: [] })

    await expect(parseHwp(Buffer.from('dummy'))).rejects.toThrow('권장: .hwpx 포맷으로 저장 후 업로드')
  })

  it('라이브러리 에러 시 HWPX 권장 메시지를 포함한다', async () => {
    mockToMarkdown.mockImplementation(() => {
      throw new Error('unsupported format')
    })

    await expect(parseHwp(Buffer.from('dummy'))).rejects.toThrow('권장: .hwpx 포맷으로 저장 후 업로드')
  })

  it('metadata로 frontmatter를 생성한다', async () => {
    mockToMarkdown.mockReturnValue({
      markdown: '내용',
      images: [],
    })

    const result = await parseHwp(Buffer.from('dummy'), {
      title: 'My Novel',
      subtitle: '부제',
    })
    expect(result.frontmatter.slug).toBe('my-novel')
    expect(result.frontmatter.type).toBe('episode')
    expect(result.frontmatter.subtitle).toBe('부제')
  })

  it('metadata 없으면 slug를 untitled로 설정한다', async () => {
    mockToMarkdown.mockReturnValue({ markdown: '내용', images: [] })

    const result = await parseHwp(Buffer.from('dummy'))
    expect(result.frontmatter.slug).toBe('untitled')
  })
})

// ── parseHwpx 테스트 ──

describe('parseHwpx', () => {
  it('section XML에서 문단을 추출한다', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
               xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
        <hp:p id="0" styleIDRef="0">
          <hp:run><hp:t>첫 번째 문단입니다.</hp:t></hp:run>
        </hp:p>
        <hp:p id="1" styleIDRef="0">
          <hp:run><hp:t>두 번째 문단입니다.</hp:t></hp:run>
        </hp:p>
      </hs:sec>`

    const buffer = await createHwpxBuffer(xml)
    const result = await parseHwpx(buffer)

    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0]).toEqual({ type: 'paragraph', text: '첫 번째 문단입니다.' })
    expect(result.blocks[1]).toEqual({ type: 'paragraph', text: '두 번째 문단입니다.' })
  })

  it('여러 run의 텍스트를 결합한다', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
               xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
        <hp:p id="0" styleIDRef="0">
          <hp:run><hp:t>앞부분 </hp:t></hp:run>
          <hp:run><hp:t>뒷부분</hp:t></hp:run>
        </hp:p>
      </hs:sec>`

    const buffer = await createHwpxBuffer(xml)
    const result = await parseHwpx(buffer)

    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0]).toEqual({ type: 'paragraph', text: '앞부분뒷부분' })
  })

  it('개요 스타일(styleIDRef=1~2)을 heading 블록으로 변환한다', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
               xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
        <hp:p id="0" styleIDRef="1">
          <hp:run><hp:t>대제목</hp:t></hp:run>
        </hp:p>
        <hp:p id="1" styleIDRef="2">
          <hp:run><hp:t>소제목</hp:t></hp:run>
        </hp:p>
      </hs:sec>`

    const buffer = await createHwpxBuffer(xml)
    const result = await parseHwpx(buffer)

    expect(result.blocks[0]).toEqual({ type: 'heading-1', title: '대제목' })
    expect(result.blocks[1]).toEqual({ type: 'heading-2', title: '소제목' })
  })

  it('개요 스타일(styleIDRef=3+)을 chapter 블록으로 변환한다', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
               xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
        <hp:p id="0" styleIDRef="3">
          <hp:run><hp:t>챕터 제목</hp:t></hp:run>
        </hp:p>
      </hs:sec>`

    const buffer = await createHwpxBuffer(xml)
    const result = await parseHwpx(buffer)

    expect(result.blocks[0]).toEqual({ type: 'chapter', title: '챕터 제목' })
  })

  it('챕터 번호 패턴(N. 제목)을 감지한다', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
               xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
        <hp:p id="0" styleIDRef="3">
          <hp:run><hp:t>1. 첫 번째 장</hp:t></hp:run>
        </hp:p>
      </hs:sec>`

    const buffer = await createHwpxBuffer(xml)
    const result = await parseHwpx(buffer)

    expect(result.blocks[0]).toEqual({ type: 'chapter', num: '1', title: '첫 번째 장' })
  })

  it('구분선 패턴을 divider로 변환한다', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
               xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
        <hp:p id="0" styleIDRef="0">
          <hp:run><hp:t>문단 1</hp:t></hp:run>
        </hp:p>
        <hp:p id="1" styleIDRef="0">
          <hp:run><hp:t>―――</hp:t></hp:run>
        </hp:p>
        <hp:p id="2" styleIDRef="0">
          <hp:run><hp:t>문단 2</hp:t></hp:run>
        </hp:p>
      </hs:sec>`

    const buffer = await createHwpxBuffer(xml)
    const result = await parseHwpx(buffer)

    expect(result.blocks).toHaveLength(3)
    expect(result.blocks[1]).toEqual({ type: 'separator' })
  })

  it('빈 문단은 무시한다', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
               xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
        <hp:p id="0" styleIDRef="0">
          <hp:run><hp:t>   </hp:t></hp:run>
        </hp:p>
        <hp:p id="1" styleIDRef="0">
          <hp:run><hp:t>실제 내용</hp:t></hp:run>
        </hp:p>
      </hs:sec>`

    const buffer = await createHwpxBuffer(xml)
    const result = await parseHwpx(buffer)

    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0]).toEqual({ type: 'paragraph', text: '실제 내용' })
  })

  it('XML 엔티티를 디코딩한다', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
               xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
        <hp:p id="0" styleIDRef="0">
          <hp:run><hp:t>A &amp; B &lt;C&gt; &quot;D&quot;</hp:t></hp:run>
        </hp:p>
      </hs:sec>`

    const buffer = await createHwpxBuffer(xml)
    const result = await parseHwpx(buffer)

    expect(result.blocks[0]).toEqual({ type: 'paragraph', text: 'A & B <C> "D"' })
  })

  it('section 파일이 없으면 에러를 던진다', async () => {
    const zip = new JSZip()
    zip.file('META-INF/manifest.xml', '<manifest/>')
    const buffer = await zip.generateAsync({ type: 'nodebuffer' }) as Buffer

    await expect(parseHwpx(buffer)).rejects.toThrow('section XML을 찾을 수 없습니다')
  })

  it('유효하지 않은 ZIP이면 에러를 던진다', async () => {
    await expect(parseHwpx(Buffer.from('not a zip'))).rejects.toThrow('HWPX 파일 파싱 실패')
  })

  it('metadata로 frontmatter를 생성한다', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
               xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
        <hp:p id="0" styleIDRef="0">
          <hp:run><hp:t>내용</hp:t></hp:run>
        </hp:p>
      </hs:sec>`

    const buffer = await createHwpxBuffer(xml)
    const result = await parseHwpx(buffer, { title: 'Test Title', subtitle: '부제' })

    expect(result.frontmatter.slug).toBe('test-title')
    expect(result.frontmatter.type).toBe('episode')
    expect(result.frontmatter.subtitle).toBe('부제')
  })

  it('압축해제 크기가 50MB 초과하면 에러를 던진다 (Zip Bomb 방어)', async () => {
    // 50MB 이상의 콘텐츠를 가진 ZIP 생성
    const zip = new JSZip()
    // 각 파일이 10MB씩, 6개 = 60MB > 50MB 제한
    for (let i = 0; i < 6; i++) {
      zip.file(`Contents/section${i}.xml`, 'x'.repeat(10 * 1024 * 1024))
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' }) as Buffer

    await expect(parseHwpx(buffer)).rejects.toThrow('압축해제 50MB 초과')
  })

  it('여러 section 파일을 순서대로 파싱한다', async () => {
    const xml0 = `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
               xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
        <hp:p id="0" styleIDRef="0">
          <hp:run><hp:t>첫 섹션</hp:t></hp:run>
        </hp:p>
      </hs:sec>`
    const xml1 = `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
               xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
        <hp:p id="0" styleIDRef="0">
          <hp:run><hp:t>둘째 섹션</hp:t></hp:run>
        </hp:p>
      </hs:sec>`

    const zip = new JSZip()
    zip.file('Contents/section0.xml', xml0)
    zip.file('Contents/section1.xml', xml1)
    const buffer = await zip.generateAsync({ type: 'nodebuffer' }) as Buffer

    const result = await parseHwpx(buffer)

    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0]).toEqual({ type: 'paragraph', text: '첫 섹션' })
    expect(result.blocks[1]).toEqual({ type: 'paragraph', text: '둘째 섹션' })
  })
})
