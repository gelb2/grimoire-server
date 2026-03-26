import { parseFrontmatter, parseEpisodeBlocks, parsePreface, parseAfterword } from './md-parser'

describe('md-parser', () => {
  describe('parseFrontmatter', () => {
    it('frontmatter를 파싱한다', () => {
      const content = `---
slug: ep1
type: episode
num: "1"
subtitle: "숲속의 목격자"
---
# 선녀와 나무꾼

본문 내용`

      const { frontmatter, body } = parseFrontmatter(content)

      expect(frontmatter.slug).toBe('ep1')
      expect(frontmatter.type).toBe('episode')
      expect(frontmatter.num).toBe('1')
      expect(frontmatter.subtitle).toBe('숲속의 목격자')
      expect(body).toContain('# 선녀와 나무꾼')
    })

    it('frontmatter가 없으면 에러를 던진다', () => {
      expect(() => parseFrontmatter('no frontmatter')).toThrow('frontmatter가 없습니다')
    })

    it('slug가 없으면 에러를 던진다', () => {
      const content = `---
type: episode
---
본문`
      expect(() => parseFrontmatter(content)).toThrow('slug와 type은 필수')
    })

    it('따옴표를 제거한다', () => {
      const content = `---
slug: "ep1"
type: 'episode'
---
본문`
      const { frontmatter } = parseFrontmatter(content)
      expect(frontmatter.slug).toBe('ep1')
      expect(frontmatter.type).toBe('episode')
    })
  })

  describe('parseEpisodeBlocks', () => {
    it('제목(H1)을 추출한다', () => {
      const { title } = parseEpisodeBlocks('# 선녀와 나무꾼\n\n본문')
      expect(title).toBe('선녀와 나무꾼')
    })

    it('일반 문단을 paragraph 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('일반 텍스트 문단')
      expect(blocks).toEqual([{ type: 'paragraph', text: '일반 텍스트 문단' }])
    })

    it('구분선(---)을 divider 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('---')
      expect(blocks).toEqual([{ type: 'divider' }])
    })

    it('챕터(### N. 제목)를 chapter 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('### 1. 첫 번째 장')
      expect(blocks).toEqual([{ type: 'chapter', num: '1', title: '첫 번째 장' }])
    })

    it('인용문(>)을 refrain 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('> 반복되는 구절')
      expect(blocks).toEqual([{ type: 'refrain', text: '반복되는 구절' }])
    })

    it('이탤릭(*...*) 줄을 italic 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('*기울임 텍스트*')
      expect(blocks).toEqual([{ type: 'italic', text: '기울임 텍스트' }])
    })

    it('에필로그 패턴을 epilogue 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('### 에필로그')
      expect(blocks).toEqual([{ type: 'epilogue' }])
    })

    it('에필로그 + 부제를 처리한다', () => {
      const { blocks } = parseEpisodeBlocks('### 에필로그: 유황불의 도시')
      expect(blocks).toHaveLength(2)
      expect(blocks[0]).toEqual({ type: 'epilogue' })
      expect(blocks[1]).toEqual({ type: 'paragraph', text: '유황불의 도시' })
    })

    it('빈 줄과 H2를 무시한다', () => {
      const { blocks } = parseEpisodeBlocks('\n\n## 부제목\n\n텍스트')
      expect(blocks).toEqual([{ type: 'paragraph', text: '텍스트' }])
    })

    it('리뷰 블록을 수집한다', () => {
      const md = `> ★★★★★
>
> 정말 재미있는 소설!

> ★☆☆☆☆
>
> 별로였습니다`

      const { blocks } = parseEpisodeBlocks(md)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('reviews-wrap')
      expect(blocks[0].children).toHaveLength(2)
      expect(blocks[0].children![0].stars).toBe('★★★★★')
      expect(blocks[0].children![0].reviewText).toBe('정말 재미있는 소설!')
      expect(blocks[0].children![1].variant).toBe('professor')
    })

    it('복합 에피소드 본문을 파싱한다', () => {
      const md = `# 에피소드 제목

### 1. 첫 장

첫 번째 문단

*이탤릭 문단*

---

### 2. 둘째 장

> 반복구

마지막 문단`

      const { title, blocks } = parseEpisodeBlocks(md)
      expect(title).toBe('에피소드 제목')
      expect(blocks).toHaveLength(7)
      expect(blocks[0].type).toBe('chapter')
      expect(blocks[1].type).toBe('paragraph')
      expect(blocks[2].type).toBe('italic')
      expect(blocks[3].type).toBe('divider')
      expect(blocks[4].type).toBe('chapter')
      expect(blocks[5].type).toBe('refrain')
      expect(blocks[6].type).toBe('paragraph')
    })
  })

  describe('parsePreface', () => {
    it('문단과 lastLine을 추출한다', () => {
      const body = `# 일러두기

첫 번째 문단

두 번째 문단

*서명 라인*`

      const { paragraphs, lastLine } = parsePreface(body)
      expect(paragraphs).toEqual(['첫 번째 문단', '두 번째 문단'])
      expect(lastLine).toBe('서명 라인')
    })

    it('이탤릭이 없으면 마지막 문단을 lastLine으로 사용한다', () => {
      const { paragraphs, lastLine } = parsePreface('문단 1\n\n마지막 문단')
      expect(paragraphs).toEqual(['문단 1'])
      expect(lastLine).toBe('마지막 문단')
    })
  })

  describe('parseAfterword', () => {
    it('글리치 텍스트와 각주를 분리한다', () => {
      const body = `# 후기

깨진 텍스트 줄 1
깨진 텍스트 줄 2

---

*각주 텍스트*`

      const { glitchText, footnote } = parseAfterword(body)
      expect(glitchText).toContain('깨진 텍스트 줄 1')
      expect(glitchText).toContain('깨진 텍스트 줄 2')
      expect(footnote).toBe('각주 텍스트')
    })

    it('각주가 이탤릭이 아닌 경우도 처리한다', () => {
      const body = `글리치

---

일반 각주`
      const { footnote } = parseAfterword(body)
      expect(footnote).toBe('일반 각주')
    })
  })
})
