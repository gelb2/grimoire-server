import { Block, Frontmatter } from '@domain/model'

/**
 * HTML → Block[] 파서
 * 기본 HTML 태그를 소설 블록으로 변환한다.
 * 복잡한 CSS/JS는 무시하고, 텍스트 콘텐츠만 추출한다.
 */

/** HTML 태그 제거 (인라인 <em>, <strong> 등은 마크다운으로 변환) */
function stripInlineHtml(html: string): string {
  return html
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/** 블록 레벨 태그에서 콘텐츠 추출 */
function extractBlocks(html: string): Block[] {
  const blocks: Block[] = []

  // <style>, <script>, <head> 제거
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')

  // body 태그 내용만 추출 (있으면)
  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*)<\/body>/i)
  const content = bodyMatch ? bodyMatch[1] : cleaned

  // 블록 레벨 태그 매칭 (순서대로 처리)
  const tagPattern = /<(h[1-6]|p|div|blockquote|hr|li|ul|ol)[^>]*>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(content)) !== null) {
    const fullMatch = match[0]

    // 자기 닫힘 <hr /> 처리
    if (/^<hr/i.test(fullMatch)) {
      blocks.push({ type: 'separator' })
      continue
    }

    const tag = match[1]?.toLowerCase()
    const inner = match[2] ?? ''
    const text = stripInlineHtml(inner)

    if (!text) continue

    switch (tag) {
      case 'h1':
        blocks.push({ type: 'heading-1', title: text })
        break
      case 'h2':
        blocks.push({ type: 'heading-2', title: text })
        break
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        // 챕터 번호 패턴 감지: "1. 제목" 또는 "제 1장"
        const chapterMatch = text.match(/^(\d+)\.\s+(.+)$/)
        if (chapterMatch) {
          blocks.push({ type: 'chapter', num: chapterMatch[1], title: chapterMatch[2] })
        } else {
          blocks.push({ type: 'chapter', title: text })
        }
        break
      }
      case 'blockquote':
        blocks.push({ type: 'refrain', text })
        break
      case 'li':
        blocks.push({ type: 'paragraph', text: `· ${text}` })
        break
      case 'p':
      case 'div':
      default:
        blocks.push({ type: 'paragraph', text })
        break
    }
  }

  // 태그 매칭이 안 된 경우 (순수 텍스트 HTML) — 줄바꿈 기반으로 분리
  if (blocks.length === 0) {
    const plainText = stripInlineHtml(content)
    const lines = plainText.split(/\n+/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        blocks.push({ type: 'paragraph', text: trimmed })
      }
    }
  }

  return blocks
}

/** HTML 제목 추출 (<h1> 또는 <title>) */
function extractTitle(html: string): string {
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1Match) return stripInlineHtml(h1Match[1])

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) return stripInlineHtml(titleMatch[1])

  return ''
}

export function parseHtml(
  rawHtml: string,
  metadata?: { title?: string; subtitle?: string },
): { frontmatter: Frontmatter; blocks: Block[] } {
  const blocks = extractBlocks(rawHtml)
  const title = metadata?.title || extractTitle(rawHtml)

  const frontmatter: Frontmatter = {
    slug: title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'untitled',
    type: 'episode',
    subtitle: metadata?.subtitle,
    description: undefined,
  }

  return { frontmatter, blocks }
}
