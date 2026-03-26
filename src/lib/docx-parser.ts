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

    // <hr> 구분선
    if (/^<hr\s*\/?>$/i.test(trimmed)) {
      blocks.push({ type: 'divider' })
      continue
    }

    // <h1>~<h6> 제목 -> chapter 블록
    const headingMatch = trimmed.match(/^<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
    if (headingMatch) {
      const text = stripHtmlTags(headingMatch[1]).trim()
      if (text) blocks.push({ type: 'chapter', text })
      continue
    }

    // <p> 문단
    const pMatch = trimmed.match(/^<p[^>]*>([\s\S]*?)<\/p>/i)
    if (pMatch) {
      const text = stripHtmlTags(pMatch[1]).trim()
      if (text) {
        // 이탤릭 전용 문단 감지
        if (/^<em>([\s\S]*?)<\/em>$/i.test(pMatch[1].trim())) {
          blocks.push({ type: 'italic', text })
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

/** HTML 태그를 제거하고 텍스트만 추출 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}
