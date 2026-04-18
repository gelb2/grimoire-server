import { Injectable, BadRequestException } from '@nestjs/common'
import { Block } from '@domain/model/block'
import { Frontmatter } from '@domain/model/frontmatter'
import { normalizeTitle } from '@domain/model/title-normalizer'
import { parseFrontmatter, parseEpisodeBlocks, parsePreface, parseAfterword } from '@lib/md-parser'
import { parseTxt } from '@lib/txt-parser'
import { parseDocx } from '@lib/docx-parser'
import { parseHwp, parseHwpx } from '@lib/hwp-parser'

export type ManuscriptFormat = 'md' | 'txt' | 'docx' | 'hwp' | 'hwpx'

export interface ParseResult {
  frontmatter: Frontmatter
  title: string
  /**
   * 저장/렌더링 안전 형태로 정규화된 제목.
   * 웹 클라이언트가 업로드 직후 input 필드에 채우면 미리보기와 DB 저장 결과가 일치한다.
   */
  normalizedTitle: string
  blocks?: Block[]
  paragraphs?: string[]
  lastLine?: string
  glitchText?: string
  footnote?: string
}

export interface ParseFromBufferInput {
  buffer: Buffer
  format: ManuscriptFormat
  filename: string
}

@Injectable()
export class ParseManuscriptUseCase {
  /** MD 텍스트 직접 파싱 (기존 엔드포인트) */
  execute(mdText: string): ParseResult {
    if (!mdText || mdText.trim().length === 0) {
      throw new BadRequestException('MD 텍스트가 비어있습니다')
    }

    const { frontmatter, body } = parseFrontmatter(mdText)

    if (frontmatter.type === 'preface') {
      const { paragraphs, lastLine } = parsePreface(body)
      const title = '일러두기'
      return { frontmatter, title, normalizedTitle: normalizeTitle(title), paragraphs, lastLine }
    }

    if (frontmatter.type === 'afterword') {
      const { glitchText, footnote } = parseAfterword(body)
      const title = '후기'
      return { frontmatter, title, normalizedTitle: normalizeTitle(title), glitchText, footnote }
    }

    // episode 또는 bonus
    const { title, blocks } = parseEpisodeBlocks(body)
    const finalTitle = title || frontmatter.slug
    return { frontmatter, title: finalTitle, normalizedTitle: normalizeTitle(finalTitle), blocks }
  }

  /** 파일 Buffer에서 포맷별 파서로 라우팅 */
  async executeFromBuffer(input: ParseFromBufferInput): Promise<ParseResult> {
    const { buffer, format, filename } = input

    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('파일이 비어있습니다')
    }

    // 파일명에서 제목 추출 (확장자 제거) — raw 값 유지, 정규화본 별도 제공
    const title = filename.replace(/\.[^.]+$/, '')
    const normalizedTitle = normalizeTitle(title)
    const metadata = { title }

    switch (format) {
      case 'md': {
        const rawContent = buffer.toString('utf-8')
        return this.execute(rawContent)
      }
      case 'txt': {
        const rawContent = buffer.toString('utf-8')
        const result = parseTxt(rawContent, metadata)
        return { frontmatter: result.frontmatter, title, normalizedTitle, blocks: result.blocks }
      }
      case 'docx': {
        try {
          const result = await parseDocx(buffer, metadata)
          return { frontmatter: result.frontmatter, title, normalizedTitle, blocks: result.blocks }
        } catch (err) {
          throw new BadRequestException(err instanceof Error ? err.message : 'DOCX 파싱 실패')
        }
      }
      case 'hwp': {
        try {
          const result = await parseHwp(buffer, metadata)
          return { frontmatter: result.frontmatter, title, normalizedTitle, blocks: result.blocks }
        } catch (err) {
          throw new BadRequestException(err instanceof Error ? err.message : 'HWP 파싱 실패')
        }
      }
      case 'hwpx': {
        try {
          const result = await parseHwpx(buffer, metadata)
          return { frontmatter: result.frontmatter, title, normalizedTitle, blocks: result.blocks }
        } catch (err) {
          throw new BadRequestException(err instanceof Error ? err.message : 'HWPX 파싱 실패')
        }
      }
      default:
        throw new BadRequestException(`지원하지 않는 포맷: ${format}`)
    }
  }
}
