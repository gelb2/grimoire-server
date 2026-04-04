import * as mammoth from 'mammoth'
import { Block, Frontmatter } from '@domain/model'

/**
 * DOCX 파일 Buffer를 Block[]로 변환하는 파서
 * mammoth로 HTML 추출 -> 간단한 HTML->Block[] 변환
 */
export async function parseDocx(
  buffer: Buffer,
  metadata?: { title?: string; subtitle?: string },
): Promise<{ frontmatter: Frontmatter; blocks: Block[] }> {
  const result = await mammoth.convertToHtml({ buffer })
  const html = result.value
  const blocks = htmlToBlocks(html)

  const frontmatter: Frontmatter = {
    slug:
      metadata?.title
        ?.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '') || 'untitled',
    type: 'episode',
    subtitle: metadata?.subtitle,
    description: undefined,
  }

  return { frontmatter, blocks }
}

/**
 * mammoth이 출력하는 간단한 HTML을 Block[]로 변환
 * mammoth 출력은 <p>, <h1>~<h6>, <hr> 등 단순 태그만 사용
 */
function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = []

  // 간단한 접근: 태그 시작 기준으로 분리
  const lines = html.split(/(?=<[ph]|<hr)/i).filter(Boolean)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // <hr> 구분선 → MD 파서의 --- (separator)와 동일
    if (/^<hr\s*\/?>$/i.test(trimmed)) {
      blocks.push({ type: 'separator' })
      continue
    }

    // <h1>~<h6> 제목 → MD 파서와 동일한 블록 타입으로 변환
    const headingMatch = trimmed.match(/^<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/i)
    if (headingMatch) {
      const level = parseInt(headingMatch[1], 10)
      const headingTitle = stripHtmlTags(headingMatch[2]).trim()
      if (headingTitle) {
        if (level === 1) {
          blocks.push({ type: 'heading-1', title: headingTitle })
        } else if (level === 2) {
          blocks.push({ type: 'heading-2', title: headingTitle })
        } else {
          // h3 이하 → chapter (MD 파서의 ### 처리와 동일)
          const chapterNumMatch = headingTitle.match(/^(\d+)\.\s+(.+)$/)
          if (chapterNumMatch) {
            blocks.push({ type: 'chapter', num: chapterNumMatch[1], title: chapterNumMatch[2] })
          } else {
            blocks.push({ type: 'chapter', title: headingTitle })
          }
        }
      }
      continue
    }

    // <p> 문단
    const pMatch = trimmed.match(/^<p[^>]*>([\s\S]*?)<\/p>/i)
    if (pMatch) {
      const text = stripHtmlTags(pMatch[1]).trim()
      if (text) {
        // 전체 줄 이탤릭/볼드 감지 (stripHtmlTags가 마크다운으로 변환한 후)
        const italicFullLine = text.match(/^\*([^*]+)\*$/)
        const boldFullLine = text.match(/^\*\*([^*]+)\*\*$/)
        if (boldFullLine) {
          blocks.push({ type: 'bold', text: boldFullLine[1] })
        } else if (italicFullLine) {
          blocks.push({ type: 'italic', text: italicFullLine[1] })
        } else {
          blocks.push({ type: 'paragraph', text })
        }
      }
      continue
    }

    // 기타: 태그 벗기고 paragraph로 처리
    const stripped = stripHtmlTags(trimmed).trim()
    if (stripped) {
      blocks.push({ type: 'paragraph', text: stripped })
    }
  }

  return blocks
}

/** HTML 서식을 마크다운 인라인 문법으로 변환한 뒤 나머지 태그 제거
 *  <strong>볼드</strong> → **볼드**
 *  <em>이탤릭</em> → *이탤릭*
 *  서식 유실 방지: 반드시 마크다운 변환 먼저, 태그 제거는 마지막 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    // 볼드+이탤릭 조합 (순서 중요: strong>em, em>strong 둘 다)
    .replace(/<strong>\s*<em>([\s\S]*?)<\/em>\s*<\/strong>/gi, '***$1***')
    .replace(/<em>\s*<strong>([\s\S]*?)<\/strong>\s*<\/em>/gi, '***$1***')
    // 볼드
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
    // 이탤릭
    .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
    // 밑줄 → HTML <u> 태그로 보존 (프론트에서 parseInlineText가 처리)
    .replace(/<u>([\s\S]*?)<\/u>/gi, '<u>$1</u>')
    // 취소선 → ~~text~~ (마크다운 확장)
    .replace(/<s>([\s\S]*?)<\/s>/gi, '~~$1~~')
    .replace(/<del>([\s\S]*?)<\/del>/gi, '~~$1~~')
    .replace(/<strike>([\s\S]*?)<\/strike>/gi, '~~$1~~')
    // 나머지 태그 제거
    .replace(/<[^>]+>/g, '')
    // HTML 엔티티 디코딩
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}
