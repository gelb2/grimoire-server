import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { BlobStoragePort } from '@domain/port/outbound/blob-storage.port'
import { Work, Episode } from '@domain/model/work'
import { Block } from '@domain/model/block'

@Injectable()
export class WorkManagementUseCase {
  constructor(
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('BlobStoragePort') private readonly blobStorage: BlobStoragePort,
  ) {}

  /** 작품 생성 */
  async createWork(authorId: string, input: { slug: string; title: string; subtitle?: string; description?: string }): Promise<Work> {
    return this.workRepo.createWork({ authorId, ...input })
  }

  /** 커버 이미지 업로드 (소유권 검증) */
  async uploadCoverImage(authorId: string, workId: string, buffer: Buffer, filename: string, mimeType: string): Promise<Work> {
    const work = await this.workRepo.findById(workId)
    if (!work) throw new NotFoundException('작품을 찾을 수 없습니다')
    if (work.authorId !== authorId) throw new ForbiddenException('작품 수정 권한이 없습니다')

    // 이전 커버 이미지 삭제
    if (work.coverImage) {
      await this.blobStorage.deleteImage(work.coverImage)
    }

    const coverImage = await this.blobStorage.uploadImage(buffer, filename, mimeType)
    return this.workRepo.updateWork(workId, { coverImage })
  }

  /** 작품 수정 (소유권 검증) */
  async updateWork(authorId: string, workId: string, input: { title?: string; subtitle?: string; description?: string }): Promise<Work> {
    const work = await this.workRepo.findById(workId)
    if (!work) throw new NotFoundException('작품을 찾을 수 없습니다')
    if (work.authorId !== authorId) throw new ForbiddenException('작품 수정 권한이 없습니다')

    return this.workRepo.updateWork(workId, input)
  }

  /** 작품 삭제 (소유권 검증, 에피소드 cascade) */
  async deleteWork(authorId: string, workId: string): Promise<void> {
    const work = await this.workRepo.findById(workId)
    if (!work) throw new NotFoundException('작품을 찾을 수 없습니다')
    if (work.authorId !== authorId) throw new ForbiddenException('작품 삭제 권한이 없습니다')

    await this.workRepo.deleteWork(workId)
  }

  /** 에피소드 생성 */
  async createEpisode(
    authorId: string,
    workId: string,
    input: { title: string; rawContent: string; sourceFormat?: string },
  ): Promise<Episode> {
    const work = await this.workRepo.findById(workId)
    if (!work) throw new NotFoundException('작품을 찾을 수 없습니다')
    if (work.authorId !== authorId) throw new ForbiddenException('에피소드 생성 권한이 없습니다')

    // 슬러그 생성 (타이틀 기반, ASCII만 허용 — 한글 제외)
    const slug = input.title.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

    // 다음 orderNum 계산
    const episodeCount = await this.workRepo.countEpisodesByWorkId(work.id)
    const orderNum = episodeCount + 1

    // 포맷에 따라 블록 파싱 (rawContent → Block[])
    const blocks = this.parseContentToBlocks(input.rawContent, input.sourceFormat)

    return this.workRepo.createEpisode({
      workId: work.id,
      slug: slug || `episode-${orderNum}`,
      title: input.title,
      orderNum,
      blocks,
      rawMd: input.rawContent,
      sourceFormat: input.sourceFormat || 'markdown',
    })
  }

  /** 에피소드 삭제 (소유권 검증) */
  async deleteEpisode(authorId: string, episodeId: string): Promise<void> {
    const episode = await this.workRepo.findEpisodeById(episodeId)
    if (!episode) throw new NotFoundException('에피소드를 찾을 수 없습니다')

    const work = await this.workRepo.findById(episode.workId)
    if (!work || work.authorId !== authorId) throw new ForbiddenException('에피소드 삭제 권한이 없습니다')

    await this.workRepo.deleteEpisode(episodeId)
  }

  /** rawContent를 Block[]으로 변환 — 포맷에 따라 적절한 파서 선택 */
  private parseContentToBlocks(rawContent: string, sourceFormat?: string): Block[] {
    const format = sourceFormat || this.detectFormat(rawContent)

    if (format === 'html') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { parseHtml } = require('../../lib/html-parser')
      const { blocks } = parseHtml(rawContent)
      return blocks
    }

    if (format === 'txt') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { parseTxt } = require('../../lib/txt-parser')
      const { blocks } = parseTxt(rawContent)
      return blocks
    }

    // markdown (기본)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mdParser = require('../../lib/md-parser')

    // frontmatter 제거 후 본문 추출
    let body = rawContent
    try {
      const parsed = mdParser.parseFrontmatter(rawContent)
      body = parsed.body
    } catch {
      const match = rawContent.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
      if (match) body = match[1]
    }

    const { blocks } = mdParser.parseEpisodeBlocks(body)
    return blocks
  }

  /** 콘텐츠 포맷 자동 감지 */
  private detectFormat(content: string): string {
    if (/<\/?[a-z][\s\S]*>/i.test(content) && !content.startsWith('---')) return 'html'
    if (content.startsWith('---') || /^#{1,6}\s/m.test(content)) return 'markdown'
    return 'txt'
  }
}
