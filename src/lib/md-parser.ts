/**
 * MD → Block[] 파서 — DeerDevil에서 이관
 *
 * 서버사이드 전용: TS 파일 생성 기능은 제외하고
 * MD 텍스트 → Block[] 변환만 수행한다.
 */
import { Block } from '@domain/model/block'
import { Frontmatter } from '@domain/model/frontmatter'

// ── Frontmatter 파싱 ──

export function parseFrontmatter(content: string): {
  frontmatter: Frontmatter
  body: string
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) {
    throw new Error('frontmatter가 없습니다. ---로 감싸진 메타데이터를 추가하세요.')
  }

  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    meta[key] = val
  }

  if (!meta.slug || !meta.type) {
    throw new Error('frontmatter에 slug와 type은 필수입니다.')
  }

  return {
    frontmatter: meta as unknown as Frontmatter,
    body: match[2],
  }
}

// ── 에피소드/번외 본문 → Block[] 파싱 ──

export function parseEpisodeBlocks(body: string): { title: string; blocks: Block[] } {
  const lines = body.split('\n')
  const blocks: Block[] = []
  let title = ''
  let i = 0

  while (i < lines.length) {
    const trimmed = lines[i].trim()

    if (trimmed === '') {
      i++
      continue
    }

    // # 제목 (H1) → title 추출 + heading-1 블록
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      title = trimmed.slice(2).trim()
      blocks.push({ type: 'heading-1', title })
      i++
      continue
    }

    // ## 부제 (H2) → heading-2 블록
    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      blocks.push({ type: 'heading-2', title: trimmed.slice(3).trim() })
      i++
      continue
    }

    // --- 구분선 → separator 블록
    if (/^-{3,}$/.test(trimmed)) {
      blocks.push({ type: 'separator' })
      i++
      continue
    }

    // * * * 또는 · · · → divider 블록
    if (/^(\*\s*\*\s*\*|·\s*·\s*·)$/.test(trimmed)) {
      blocks.push({ type: 'divider' })
      i++
      continue
    }

    // ### 에필로그 패턴
    if (trimmed.startsWith('### ') && /에필로그/.test(trimmed)) {
      blocks.push({ type: 'epilogue' })
      const epilogueTitle = trimmed.replace(/^###\s*에필로그[:\s]*/, '').trim()
      if (epilogueTitle) {
        blocks.push({ type: 'paragraph', text: epilogueTitle })
      }
      i++
      continue
    }

    // ### N. 챕터 제목
    const chapterMatch = trimmed.match(/^###\s+(\d+)\.\s+(.+)$/)
    if (chapterMatch) {
      blocks.push({ type: 'chapter', num: chapterMatch[1], title: chapterMatch[2] })
      i++
      continue
    }

    // ### 일반 제목 (번호 없는 챕터) → chapter 블록 (num 없음)
    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'chapter', title: trimmed.slice(4).trim() })
      i++
      continue
    }

    // > 인용문
    if (trimmed.startsWith('> ')) {
      const quoteText = trimmed.slice(2).trim()

      // ★/☆ 로 시작하면 리뷰 블록 수집
      if (/^[★☆]/.test(quoteText)) {
        const reviewResult = collectReviews(lines, i)
        if (reviewResult.block.children && reviewResult.block.children.length > 0) {
          blocks.push(reviewResult.block)
          i = reviewResult.nextIndex
          continue
        }
      }

      blocks.push({ type: 'refrain', text: quoteText })
      i++
      continue
    }

    // **전체 볼드 문단**
    const boldMatch = trimmed.match(/^\*\*([^*]+)\*\*$/)
    if (boldMatch) {
      blocks.push({ type: 'bold', text: boldMatch[1] })
      i++
      continue
    }

    // *전체 이탤릭 문단*
    const italicMatch = trimmed.match(/^\*([^*]+)\*$/)
    if (italicMatch) {
      blocks.push({ type: 'italic', text: italicMatch[1] })
      i++
      continue
    }

    // 일반 문단
    blocks.push({ type: 'paragraph', text: trimmed })
    i++
  }

  return { title, blocks }
}

// ── 리뷰 블록 수집 ──

function collectReviews(
  lines: string[],
  startIndex: number,
): { block: Block; nextIndex: number } {
  const children: Block[] = []
  let i = startIndex

  while (i < lines.length) {
    const trimmed = lines[i].trim()

    if (trimmed === '' || trimmed === '>' || /^-{3,}$/.test(trimmed)) {
      i++
      continue
    }

    if (trimmed.startsWith('> ')) {
      const quoteText = trimmed.slice(2).trim()

      if (/^[★☆]/.test(quoteText)) {
        const stars = quoteText
        i++

        while (i < lines.length && (lines[i].trim() === '' || lines[i].trim() === '>')) i++

        if (i < lines.length && lines[i].trim().startsWith('> ')) {
          const reviewText = lines[i].trim().slice(2).trim()
          const isProfessor = stars.includes('☆')
          const review: Block = { type: 'review', stars, reviewText }
          if (isProfessor) review.variant = 'professor'
          children.push(review)
          i++
        }
        continue
      }
    }

    break
  }

  return {
    block: { type: 'reviews-wrap', children },
    nextIndex: i,
  }
}

// ── Preface 파싱 ──

export function parsePreface(body: string): { paragraphs: string[]; lastLine: string } {
  const lines = body.split('\n')
  const paragraphs: string[] = []
  let lastLine = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || /^-{3,}$/.test(trimmed)) continue

    const italicMatch = trimmed.match(/^\*([^*]+)\*$/)
    if (italicMatch) {
      lastLine = italicMatch[1]
      continue
    }

    paragraphs.push(trimmed)
  }

  if (!lastLine && paragraphs.length > 0) {
    lastLine = paragraphs.pop()!
  }

  return { paragraphs, lastLine }
}

// ── Afterword 파싱 ──

export function parseAfterword(body: string): { glitchText: string; footnote: string } {
  const lines = body.split('\n')
  const glitchLines: string[] = []
  let footnote = ''
  let foundDivider = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) continue

    if (/^-{3,}$/.test(trimmed)) {
      foundDivider = true
      continue
    }

    if (trimmed === '') continue

    if (foundDivider) {
      const italicMatch = trimmed.match(/^\*([^*]+)\*$/)
      footnote = italicMatch ? italicMatch[1] : trimmed
    } else {
      glitchLines.push(line)
    }
  }

  return { glitchText: glitchLines.join('\n'), footnote }
}
