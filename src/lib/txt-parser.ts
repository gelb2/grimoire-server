import { Block, Frontmatter } from '@domain/model'

/**
 * TXT 파일을 Block[]로 변환하는 파서
 * 줄바꿈 기반으로 문단을 분리한다
 */
export function parseTxt(rawText: string, metadata?: { title?: string; subtitle?: string }): { frontmatter: Frontmatter; blocks: Block[] } {
  const lines = rawText.split(/\r?\n/)
  const blocks: Block[] = []
  let currentParagraph: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === '') {
      // 빈 줄: 현재 문단 마감
      if (currentParagraph.length > 0) {
        blocks.push({
          type: 'paragraph',
          text: currentParagraph.join(' '),
        })
        currentParagraph = []
      }
    } else if (trimmed === '---' || trimmed === '***' || trimmed === '===') {
      // 구분선
      if (currentParagraph.length > 0) {
        blocks.push({ type: 'paragraph', text: currentParagraph.join(' ') })
        currentParagraph = []
      }
      blocks.push({ type: 'divider' })
    } else {
      currentParagraph.push(trimmed)
    }
  }

  // 마지막 문단 처리
  if (currentParagraph.length > 0) {
    blocks.push({ type: 'paragraph', text: currentParagraph.join(' ') })
  }

  const frontmatter: Frontmatter = {
    slug: metadata?.title?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'untitled',
    type: 'episode',
    subtitle: metadata?.subtitle,
    description: undefined,
  }

  return { frontmatter, blocks }
}

/** 파일 내용으로 포맷을 감지한다 */
export function detectFormat(content: string): 'markdown' | 'txt' | 'html' {
  // HTML 태그가 있으면 HTML
  if (/<\/?[a-z][\s\S]*>/i.test(content) && !content.startsWith('---')) {
    return 'html'
  }

  // frontmatter 또는 마크다운 문법이 있으면 MD
  if (
    content.startsWith('---') ||
    /^#{1,6}\s/.test(content) ||
    /\[.*\]\(.*\)/.test(content) ||
    /^\*\*.*\*\*/.test(content) ||
    /^>\s/.test(content)
  ) {
    return 'markdown'
  }

  return 'txt'
}
