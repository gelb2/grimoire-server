import { parseHtml } from './html-parser'

describe('parseHtml', () => {
  describe('기본 블록 변환', () => {
    it('<p> 태그를 paragraph 블록으로 변환한다', () => {
      const { blocks } = parseHtml('<p>첫 번째 문단</p><p>두 번째 문단</p>')
      expect(blocks).toHaveLength(2)
      expect(blocks[0]).toEqual({ type: 'paragraph', text: '첫 번째 문단' })
      expect(blocks[1]).toEqual({ type: 'paragraph', text: '두 번째 문단' })
    })

    it('<h1>을 heading-1 블록으로 변환한다', () => {
      const { blocks } = parseHtml('<h1>제목</h1>')
      expect(blocks[0]).toEqual({ type: 'heading-1', title: '제목' })
    })

    it('<h2>를 heading-2 블록으로 변환한다', () => {
      const { blocks } = parseHtml('<h2>부제목</h2>')
      expect(blocks[0]).toEqual({ type: 'heading-2', title: '부제목' })
    })

    it('<h3>을 chapter 블록으로 변환한다', () => {
      const { blocks } = parseHtml('<h3>장 제목</h3>')
      expect(blocks[0]).toEqual({ type: 'chapter', title: '장 제목' })
    })

    it('<h3> 번호 패턴을 chapter num으로 파싱한다', () => {
      const { blocks } = parseHtml('<h3>1. 첫 번째 장</h3>')
      expect(blocks[0]).toEqual({ type: 'chapter', num: '1', title: '첫 번째 장' })
    })

    it('<hr>을 separator 블록으로 변환한다', () => {
      const { blocks } = parseHtml('<p>앞</p><hr><p>뒤</p>')
      expect(blocks[1]).toEqual({ type: 'separator' })
    })

    it('<hr /> 자기 닫힘 태그도 처리한다', () => {
      const { blocks } = parseHtml('<p>앞</p><hr /><p>뒤</p>')
      expect(blocks[1]).toEqual({ type: 'separator' })
    })

    it('<blockquote>를 refrain 블록으로 변환한다', () => {
      const { blocks } = parseHtml('<blockquote>인용문</blockquote>')
      expect(blocks[0]).toEqual({ type: 'refrain', text: '인용문' })
    })
  })

  describe('인라인 HTML 변환', () => {
    it('<strong>을 **볼드** 마크다운으로 변환한다', () => {
      const { blocks } = parseHtml('<p>일반 <strong>강조</strong> 텍스트</p>')
      expect(blocks[0].text).toBe('일반 **강조** 텍스트')
    })

    it('<em>을 *이탤릭* 마크다운으로 변환한다', () => {
      const { blocks } = parseHtml('<p>일반 <em>기울임</em> 텍스트</p>')
      expect(blocks[0].text).toBe('일반 *기울임* 텍스트')
    })

    it('HTML 엔티티를 디코딩한다', () => {
      const { blocks } = parseHtml('<p>&amp; &lt; &gt; &quot; &#39;</p>')
      expect(blocks[0].text).toBe("& < > \" '")
    })
  })

  describe('구조 처리', () => {
    it('<body> 안의 콘텐츠만 추출한다', () => {
      const html = '<html><head><title>test</title></head><body><p>본문</p></body></html>'
      const { blocks } = parseHtml(html)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].text).toBe('본문')
    })

    it('<style>과 <script>를 무시한다', () => {
      const html = '<style>.a{color:red}</style><p>본문</p><script>alert(1)</script>'
      const { blocks } = parseHtml(html)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].text).toBe('본문')
    })

    it('빈 태그를 무시한다', () => {
      const { blocks } = parseHtml('<p></p><p>내용</p><p>  </p>')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].text).toBe('내용')
    })

    it('태그 없는 순수 텍스트도 처리한다', () => {
      const { blocks } = parseHtml('첫째 줄\n\n둘째 줄')
      expect(blocks).toHaveLength(2)
    })
  })

  describe('frontmatter 생성', () => {
    it('<h1>에서 제목을 추출하여 slug를 생성한다', () => {
      const { frontmatter } = parseHtml('<h1>My Title</h1><p>본문</p>')
      expect(frontmatter.slug).toBe('my-title')
      expect(frontmatter.type).toBe('episode')
    })

    it('metadata로 전달된 제목을 우선한다', () => {
      const { frontmatter } = parseHtml('<h1>HTML 제목</h1>', { title: 'Custom Title' })
      expect(frontmatter.slug).toBe('custom-title')
    })

    it('<title>에서도 제목을 추출한다', () => {
      const { frontmatter } = parseHtml('<html><head><title>Page Title</title></head><body><p>본문</p></body></html>')
      expect(frontmatter.slug).toBe('page-title')
    })
  })

  describe('복합 문서', () => {
    it('여러 블록 타입이 섞인 HTML을 올바르게 파싱한다', () => {
      const html = `
        <h1>소설 제목</h1>
        <h2>부제</h2>
        <p>첫 문단</p>
        <hr>
        <h3>1. 첫 번째 장</h3>
        <p>장 내용</p>
        <blockquote>인용</blockquote>
        <p>마지막</p>
      `
      const { blocks } = parseHtml(html)
      expect(blocks.map(b => b.type)).toEqual([
        'heading-1', 'heading-2', 'paragraph', 'separator',
        'chapter', 'paragraph', 'refrain', 'paragraph',
      ])
      expect(blocks[4].num).toBe('1')
      expect(blocks[4].title).toBe('첫 번째 장')
    })
  })
})
