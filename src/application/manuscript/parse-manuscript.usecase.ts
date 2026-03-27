import { Injectable, BadRequestException } from '@nestjs/common'
import { Block } from '@domain/model/block'
import { Frontmatter } from '@domain/model/frontmatter'
import { parseFrontmatter, parseEpisodeBlocks, parsePreface, parseAfterword } from '@lib/md-parser'
import { parseTxt } from '@lib/txt-parser'
import { parseDocx } from '@lib/docx-parser'
import { parseHwp, parseHwpx } from '@lib/hwp-parser'

export type ManuscriptFormat = 'md' | 'txt' | 'docx' | 'hwp' | 'hwpx'

export interface ParseResult {
  frontmatter: Frontmatter
  title: string
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
      return { frontmatter, title: '일러두기', paragraphs, lastLine }
    }

    if (frontmatter.type === 'afterword') {
      const { glitchText, footnote } = parseAfterword(body)
      return { frontmatter, title: '후기', glitchText, footnote }
    }

    // episode 또는 bonus
    const { title, blocks } = parseEpisodeBlocks(body)
    return { frontmatter, title: title || frontmatter.slug, blocks }
  }

  /** 파일 Buffer에서 포맷별 파서로 라우팅 */
  async executeFromBuffer(input: ParseFromBufferInput): Promise<ParseResult> {
    const { buffer, format, filename } = input

    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('파일이 비어있습니다')
    }

    // 파일명에서 제목 추출 (확장자 제거)
    const title = filename.replace(/\.[^.]+$/, '')
    const metadata = { title }

    switch (format) {
      case 'md': {
        const rawContent = buffer.toString('utf-8')
        return this.execute(rawContent)
      }
      case 'txt': {
        const rawContent = buffer.toString('utf-8')
        const result = parseTxt(rawContent, metadata)
        return { frontmatter: result.frontmatter, title, blocks: result.blocks }
      }
      case 'docx': {
        const result = await parseDocx(buffer, metadata)
        return { frontmatter: result.frontmatter, title, blocks: result.blocks }
      }
      case 'hwp': {
        const result = await parseHwp(buffer, metadata)
        return { frontmatter: result.frontmatter, title, blocks: result.blocks }
      }
      case 'hwpx': {
        const result = await parseHwpx(buffer, metadata)
        return { frontmatter: result.frontmatter, title, blocks: result.blocks }
      }
      default:
        throw new BadRequestException(`지원하지 않는 포맷: ${format}`)
    }
  }
}
