import { Injectable, BadRequestException } from '@nestjs/common'
import { Block } from '@domain/model/block'
import { Frontmatter } from '@domain/model/frontmatter'
import { parseFrontmatter, parseEpisodeBlocks, parsePreface, parseAfterword } from '@lib/md-parser'

export interface ParseResult {
  frontmatter: Frontmatter
  title: string
  blocks?: Block[]
  paragraphs?: string[]
  lastLine?: string
  glitchText?: string
  footnote?: string
}

@Injectable()
export class ParseManuscriptUseCase {
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
}
