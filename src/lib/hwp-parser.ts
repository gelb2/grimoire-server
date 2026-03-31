import { Block, Frontmatter } from '@domain/model'
import * as JSZip from 'jszip'

/**
 * HWP(한글 워드프로세서 바이너리) 파일을 Block[]로 변환하는 파서
 *
 * @ohah/hwpjs 라이브러리로 마크다운 변환 후 블록 파싱.
 * HWP 바이너리 포맷은 복잡하므로 라이브러리에 의존한다.
 * 파싱 실패 시 HWPX 포맷 사용을 권장하는 에러를 반환한다.
 */
export async function parseHwp(
  buffer: Buffer,
  metadata?: { title?: string; subtitle?: string },
): Promise<{ frontmatter: Frontmatter; blocks: Block[] }> {
  try {
    // @ohah/hwpjs는 CommonJS 모듈 — dynamic import 대신 require 사용
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { toMarkdown } = require('@ohah/hwpjs')

    const { markdown } = toMarkdown(buffer, { image: 'skip' })

    if (!markdown || markdown.trim().length === 0) {
      throw new Error('HWP 파일에서 텍스트를 추출할 수 없습니다')
    }

    const blocks = markdownToBlocks(markdown)
    const frontmatter = buildFrontmatter(metadata)

    return { frontmatter, blocks }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error)

    throw new Error(
      `HWP 파일 파싱 실패: ${message}. ` +
        '권장: .hwpx 포맷으로 저장 후 업로드해 주세요.',
    )
  }
}

/**
 * HWPX(한글 워드프로세서 XML) 파일을 Block[]로 변환하는 파서
 *
 * HWPX는 ZIP 컨테이너 안에 OWPML(XML) 파일들을 담고 있다.
 * Contents/section0.xml ~ sectionN.xml에서 문단(hp:p)과 텍스트(hp:t)를 추출한다.
 * 외부 라이브러리 없이 직접 XML 파싱 (정규식 기반, 소설 텍스트 추출에 충분).
 */
export async function parseHwpx(
  buffer: Buffer,
  metadata?: { title?: string; subtitle?: string },
): Promise<{ frontmatter: Frontmatter; blocks: Block[] }> {
  try {
    const zip = await JSZip.loadAsync(buffer)

    // section 파일들을 순서대로 수집
    const sectionFiles = Object.keys(zip.files)
      .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
      .sort()

    if (sectionFiles.length === 0) {
      throw new Error(
        'HWPX 파일에서 section XML을 찾을 수 없습니다. ' +
          '유효한 HWPX 파일인지 확인해 주세요.',
      )
    }

    const allBlocks: Block[] = []

    for (const sectionFile of sectionFiles) {
      const xml = await zip.files[sectionFile].async('text')
      const sectionBlocks = extractBlocksFromSectionXml(xml)
      allBlocks.push(...sectionBlocks)
    }

    const frontmatter = buildFrontmatter(metadata)

    return { frontmatter, blocks: allBlocks }
  } catch (error) {
    if (error instanceof Error && error.message.includes('HWPX')) {
      throw error
    }

    const message =
      error instanceof Error ? error.message : String(error)
    throw new Error(`HWPX 파일 파싱 실패: ${message}`)
  }
}

/**
 * OWPML section XML에서 Block[]을 추출한다
 *
 * 구조: <hp:p> → <hp:run> → <hp:t>텍스트</hp:t>
 * 문단 내 여러 run의 텍스트를 결합하여 하나의 블록으로 만든다.
 */
function extractBlocksFromSectionXml(xml: string): Block[] {
  const blocks: Block[] = []

  // <hp:p ...>...</hp:p> 문단 추출 (non-greedy, 중첩 없음)
  const paragraphRegex = /<hp:p\b[^>]*>([\s\S]*?)<\/hp:p>/g
  let pMatch: RegExpExecArray | null

  while ((pMatch = paragraphRegex.exec(xml)) !== null) {
    const paragraphContent = pMatch[1]

    // 문단 내 모든 <hp:t> 텍스트 수집
    const textParts: string[] = []
    const textRegex = /<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/g
    let tMatch: RegExpExecArray | null

    while ((tMatch = textRegex.exec(paragraphContent)) !== null) {
      const text = decodeXmlEntities(tMatch[1]).trim()
      if (text) textParts.push(text)
    }

    const fullText = textParts.join('')
    if (!fullText.trim()) continue

    const trimmedText = fullText.trim()

    // 구분선 패턴 감지 (반복 문자: -, =, _, *, ·, ―, — 등)
    // MD 파서 기준: --- → separator, * * * → divider
    if (/^[-=_―—]{3,}$/.test(trimmedText.replace(/\s/g, ''))) {
      blocks.push({ type: 'separator' })
      continue
    }
    if (/^[*·]{3,}$/.test(trimmedText.replace(/\s/g, ''))) {
      blocks.push({ type: 'divider' })
      continue
    }

    // 아웃라인 레벨 감지 (styleIDRef로 헤딩 판별)
    const styleMatch = pMatch[0].match(/styleIDRef="(\d+)"/)
    const styleId = styleMatch ? parseInt(styleMatch[1], 10) : -1

    // HWPX 스타일 ID: 0=본문, 1~9=개요(헤딩) 레벨
    // 개요 1 → heading-1, 개요 2 → heading-2, 그 외 → chapter
    if (styleId >= 1 && styleId <= 9) {
      // 챕터 번호 패턴 감지: "N. 제목" 또는 "제N장"
      const chapterNumMatch = trimmedText.match(/^(\d+)\.\s+(.+)$/)
      if (chapterNumMatch) {
        blocks.push({
          type: 'chapter',
          num: chapterNumMatch[1],
          title: chapterNumMatch[2],
        })
      } else if (styleId <= 2) {
        blocks.push({ type: `heading-${styleId}` as string, title: trimmedText })
      } else {
        blocks.push({ type: 'chapter', title: trimmedText })
      }
      continue
    }

    // 마크다운 헤딩 패턴 감지 (HWP→마크다운 변환 시 # 포함될 수 있음)
    if (trimmedText.startsWith('# ') && !trimmedText.startsWith('## ')) {
      blocks.push({ type: 'heading-1', title: trimmedText.slice(2).trim() })
      continue
    }
    if (trimmedText.startsWith('## ') && !trimmedText.startsWith('### ')) {
      blocks.push({ type: 'heading-2', title: trimmedText.slice(3).trim() })
      continue
    }
    if (trimmedText.startsWith('### ')) {
      const chapterNumMatch = trimmedText.slice(4).trim().match(/^(\d+)\.\s+(.+)$/)
      if (chapterNumMatch) {
        blocks.push({ type: 'chapter', num: chapterNumMatch[1], title: chapterNumMatch[2] })
      } else {
        blocks.push({ type: 'chapter', title: trimmedText.slice(4).trim() })
      }
      continue
    }

    // 볼드/이탤릭 전용 문단 (MD 파서와 동일)
    const boldMatch = trimmedText.match(/^\*\*([^*]+)\*\*$/)
    if (boldMatch) { blocks.push({ type: 'bold', text: boldMatch[1] }); continue }
    const italicMatch = trimmedText.match(/^\*([^*]+)\*$/)
    if (italicMatch) { blocks.push({ type: 'italic', text: italicMatch[1] }); continue }

    // 일반 문단
    blocks.push({ type: 'paragraph', text: trimmedText })
  }

  return blocks
}

/** @ohah/hwpjs가 출력하는 마크다운을 Block[]로 변환 */
function markdownToBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n')
  const blocks: Block[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // # 제목 (H1)
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      blocks.push({ type: 'heading-1', title: trimmed.slice(2).trim() })
      continue
    }

    // ## 부제 (H2)
    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      blocks.push({ type: 'heading-2', title: trimmed.slice(3).trim() })
      continue
    }

    // ### 챕터
    const chapterMatch = trimmed.match(/^###\s+(\d+)\.\s+(.+)$/)
    if (chapterMatch) {
      blocks.push({ type: 'chapter', num: chapterMatch[1], title: chapterMatch[2] })
      continue
    }

    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'chapter', title: trimmed.slice(4).trim() })
      continue
    }

    // 구분선
    if (/^-{3,}$/.test(trimmed) || /^(\*\s*){3,}$/.test(trimmed)) {
      blocks.push({ type: 'divider' })
      continue
    }

    // **볼드 전체**
    const boldMatch = trimmed.match(/^\*\*([^*]+)\*\*$/)
    if (boldMatch) {
      blocks.push({ type: 'bold', text: boldMatch[1] })
      continue
    }

    // *이탤릭 전체*
    const italicMatch = trimmed.match(/^\*([^*]+)\*$/)
    if (italicMatch) {
      blocks.push({ type: 'italic', text: italicMatch[1] })
      continue
    }

    // 일반 문단
    blocks.push({ type: 'paragraph', text: trimmed })
  }

  return blocks
}

/** XML 엔티티 디코딩 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
}

/** frontmatter 기본값 생성 */
function buildFrontmatter(metadata?: {
  title?: string
  subtitle?: string
}): Frontmatter {
  return {
    slug:
      metadata?.title
        ?.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '') || 'untitled',
    type: 'episode',
    subtitle: metadata?.subtitle,
    description: undefined,
  }
}
