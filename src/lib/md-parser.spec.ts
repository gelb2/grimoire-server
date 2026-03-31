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

    it('frontmatter가 없으면 빈 메타데이터 + 전체를 body로 반환한다', () => {
      const result = parseFrontmatter('no frontmatter')
      expect(result.frontmatter.type).toBe('episode')
      expect(result.body).toBe('no frontmatter')
    })

    it('slug가 없으면 빈 slug로 기본값 적용한다', () => {
      const content = `---
type: episode
---
본문`
      const result = parseFrontmatter(content)
      expect(result.frontmatter.slug).toBe('')
      expect(result.frontmatter.type).toBe('episode')
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
    // ── 제목 레벨 ──

    it('제목(H1)을 추출하고 heading-1 블록을 생성한다', () => {
      const { title, blocks } = parseEpisodeBlocks('# 선녀와 나무꾼\n\n본문')
      expect(title).toBe('선녀와 나무꾼')
      expect(blocks[0]).toEqual({ type: 'heading-1', title: '선녀와 나무꾼' })
      expect(blocks[1]).toEqual({ type: 'paragraph', text: '본문' })
    })

    it('부제(H2)를 heading-2 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('## 부제목 텍스트')
      expect(blocks).toEqual([{ type: 'heading-2', title: '부제목 텍스트' }])
    })

    it('H2가 H3와 혼동되지 않는다', () => {
      const { blocks } = parseEpisodeBlocks('## 부제\n\n### 1. 첫 장')
      expect(blocks[0]).toEqual({ type: 'heading-2', title: '부제' })
      expect(blocks[1]).toEqual({ type: 'chapter', num: '1', title: '첫 장' })
    })

    // ── 챕터/### 헤딩 ──

    it('챕터(### N. 제목)를 chapter 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('### 1. 첫 번째 장')
      expect(blocks).toEqual([{ type: 'chapter', num: '1', title: '첫 번째 장' }])
    })

    it('번호 없는 ### 제목을 chapter 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('### 막간: 어둠의 숲')
      expect(blocks).toEqual([{ type: 'chapter', title: '막간: 어둠의 숲' }])
    })

    it('### 9. 에필로그를 epilogue 블록으로 변환한다 (번호+에필로그 조합)', () => {
      const { blocks } = parseEpisodeBlocks('### 9. 에필로그')
      expect(blocks[0].type).toBe('epilogue')
    })

    it('### 12. 에필로그: 새벽의 서류를 epilogue + 부제로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('### 12. 에필로그: 새벽의 서류')
      expect(blocks).toHaveLength(2)
      expect(blocks[0]).toEqual({ type: 'epilogue' })
      expect(blocks[1]).toEqual({ type: 'paragraph', text: '새벽의 서류' })
    })

    // ── 에필로그 ──

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

    // ── separator와 divider ──

    it('구분선(---)을 separator 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('---')
      expect(blocks).toEqual([{ type: 'separator' }])
    })

    it('긴 구분선(-----)도 separator 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('-----')
      expect(blocks).toEqual([{ type: 'separator' }])
    })

    it('* * * 를 divider 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('* * *')
      expect(blocks).toEqual([{ type: 'divider' }])
    })

    it('· · · 를 divider 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('· · ·')
      expect(blocks).toEqual([{ type: 'divider' }])
    })

    it('*** (공백 없는 별표)를 divider 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('***')
      expect(blocks).toEqual([{ type: 'divider' }])
    })

    // ── 인용문 ──

    it('인용문(>)을 refrain 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('> 반복되는 구절')
      expect(blocks).toEqual([{ type: 'refrain', text: '반복되는 구절' }])
    })

    // ── 텍스트 스타일 ──

    it('이탤릭(*...*) 줄을 italic 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('*기울임 텍스트*')
      expect(blocks).toEqual([{ type: 'italic', text: '기울임 텍스트' }])
    })

    it('볼드(**...**) 줄을 bold 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('**굵은 텍스트**')
      expect(blocks).toEqual([{ type: 'bold', text: '굵은 텍스트' }])
    })

    it('볼드가 이탤릭보다 먼저 매칭된다', () => {
      // **text** 는 bold로, *text* 는 italic로 정확히 구분
      const { blocks } = parseEpisodeBlocks('**굵게**\n*기울임*')
      expect(blocks[0]).toEqual({ type: 'bold', text: '굵게' })
      expect(blocks[1]).toEqual({ type: 'italic', text: '기울임' })
    })

    // ── 일반 문단 ──

    it('일반 문단을 paragraph 블록으로 변환한다', () => {
      const { blocks } = parseEpisodeBlocks('일반 텍스트 문단')
      expect(blocks).toEqual([{ type: 'paragraph', text: '일반 텍스트 문단' }])
    })

    it('빈 줄을 무시한다', () => {
      const { blocks } = parseEpisodeBlocks('\n\n텍스트\n\n')
      expect(blocks).toEqual([{ type: 'paragraph', text: '텍스트' }])
    })

    // ── 리뷰 블록 ──

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

    // ── 복합 파싱 ──

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
      expect(blocks).toHaveLength(8) // heading-1 추가로 +1
      expect(blocks[0].type).toBe('heading-1')
      expect(blocks[1].type).toBe('chapter')
      expect(blocks[2].type).toBe('paragraph')
      expect(blocks[3].type).toBe('italic')
      expect(blocks[4].type).toBe('separator')
      expect(blocks[5].type).toBe('chapter')
      expect(blocks[6].type).toBe('refrain')
      expect(blocks[7].type).toBe('paragraph')
    })

    it('모든 heading 레벨을 올바르게 파싱한다', () => {
      const md = `# 대제목

## 중제목

### 1. 소제목

### 번호 없는 소제목

일반 문단`

      const { title, blocks } = parseEpisodeBlocks(md)
      expect(title).toBe('대제목')
      expect(blocks[0]).toEqual({ type: 'heading-1', title: '대제목' })
      expect(blocks[1]).toEqual({ type: 'heading-2', title: '중제목' })
      expect(blocks[2]).toEqual({ type: 'chapter', num: '1', title: '소제목' })
      expect(blocks[3]).toEqual({ type: 'chapter', title: '번호 없는 소제목' })
      expect(blocks[4]).toEqual({ type: 'paragraph', text: '일반 문단' })
    })

    it('separator와 divider를 구분한다', () => {
      const md = `문단 1

---

문단 2

* * *

문단 3`

      const { blocks } = parseEpisodeBlocks(md)
      expect(blocks[0]).toEqual({ type: 'paragraph', text: '문단 1' })
      expect(blocks[1]).toEqual({ type: 'separator' })
      expect(blocks[2]).toEqual({ type: 'paragraph', text: '문단 2' })
      expect(blocks[3]).toEqual({ type: 'divider' })
      expect(blocks[4]).toEqual({ type: 'paragraph', text: '문단 3' })
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
