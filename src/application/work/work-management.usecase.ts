import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { BlobStoragePort } from '@domain/port/outbound/blob-storage.port'
import { Work, Episode, EpisodeStatus } from '@domain/model/work'
import { Block } from '@domain/model/block'
import { normalizeTitle } from '@domain/model/title-normalizer'
import { NovelAnalysisUseCase } from '@application/analysis/novel-analysis.usecase'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { CreditReason } from '@domain/model/credit'

@Injectable()
export class WorkManagementUseCase {
  constructor(
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('BlobStoragePort') private readonly blobStorage: BlobStoragePort,
    private readonly novelAnalysis: NovelAnalysisUseCase,
    private readonly creditUseCase: CreditUseCase,
  ) {}

  /** 작품 생성 */
  async createWork(authorId: string, input: { slug: string; title: string; subtitle?: string; description?: string }): Promise<Work> {
    return this.workRepo.createWork({ authorId, ...input, title: normalizeTitle(input.title) })
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

    // title이 전달되면 정규화해서 저장 (Safari Hangul shaping 버그 회피)
    const normalized = input.title !== undefined
      ? { ...input, title: normalizeTitle(input.title) }
      : input
    return this.workRepo.updateWork(workId, normalized)
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

    // 제목 정규화 (Safari Hangul shaping 버그 회피 — 단일 진실 공급원)
    const title = normalizeTitle(input.title)

    // 슬러그 생성 (정규화된 타이틀 기반, ASCII만 허용 — 한글 제외)
    const slug = title.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

    // 다음 orderNum 계산
    const episodeCount = await this.workRepo.countEpisodesByWorkId(work.id)
    const orderNum = episodeCount + 1

    // sourceFormat 검증
    const allowedFormats = ['md', 'markdown', 'txt', 'html', 'docx', 'hwp', 'hwpx']
    if (input.sourceFormat && !allowedFormats.includes(input.sourceFormat)) {
      throw new BadRequestException(`지원하지 않는 포맷: ${input.sourceFormat}`)
    }

    // 포맷에 따라 블록 파싱 + frontmatter 메타 추출 + 정규화
    const { blocks, meta } = this.parseContentWithMeta(input.rawContent, input.sourceFormat)

    const episode = await this.workRepo.createEpisode({
      workId: work.id,
      slug: meta?.slug || slug || `episode-${orderNum}`,
      title,
      subtitle: meta?.subtitle,
      description: meta?.description,
      type: meta?.type,
      orderNum,
      blocks,
      rawMd: input.rawContent,
      sourceFormat: input.sourceFormat || 'markdown',
    })

    // 비동기 RAG 인덱싱 (에피소드 생성 응답은 즉시 반환)
    if (input.rawContent.length >= 100) {
      this.novelAnalysis.indexEpisode(episode.id, work.id, input.rawContent)
        .then(() => this.workRepo.updateEpisodeIndexed(episode.id, true))
        .catch(() => { /* 인덱싱 실패해도 에피소드 생성은 성공 */ })
    }

    return episode
  }

  /** 에피소드 재업로드 (파일 교체 — 소유권 검증) */
  async reuploadEpisode(
    authorId: string,
    episodeId: string,
    input: { title?: string; rawContent: string; sourceFormat?: string },
  ): Promise<Episode> {
    const episode = await this.workRepo.findEpisodeById(episodeId)
    if (!episode) throw new NotFoundException('에피소드를 찾을 수 없습니다')

    const work = await this.workRepo.findById(episode.workId)
    if (!work || work.authorId !== authorId) throw new ForbiddenException('에피소드 수정 권한이 없습니다')

    const { blocks, meta } = this.parseContentWithMeta(input.rawContent, input.sourceFormat)

    // 제목 정규화 — input.title이 있으면 정규화해서 사용, 없으면 기존 title 유지
    // (meta.subtitle을 title로 쓰던 기존 폴백은 정규화 대상 외이므로 그대로 둔다 —
    //  별도 이슈로 다룰 예정; 이번 PR 범위는 title 정규화 파이프라인 확립)
    const normalizedInputTitle = input.title !== undefined ? normalizeTitle(input.title) : undefined

    const updated = await this.workRepo.updateEpisodeContent(episodeId, {
      title: normalizedInputTitle ?? meta?.subtitle ?? episode.title,
      subtitle: meta?.subtitle,
      description: meta?.description,
      blocks,
      rawMd: input.rawContent,
      sourceFormat: input.sourceFormat || 'markdown',
    })

    // RAG 재인덱싱
    if (input.rawContent.length >= 100) {
      this.novelAnalysis.indexEpisode(episode.id, work.id, input.rawContent)
        .then(() => this.workRepo.updateEpisodeIndexed(episode.id, true))
        .catch(() => {})
    }

    return updated
  }

  /** 에피소드 삭제 (소유권 검증) */
  async deleteEpisode(authorId: string, episodeId: string): Promise<void> {
    const episode = await this.workRepo.findEpisodeById(episodeId)
    if (!episode) throw new NotFoundException('에피소드를 찾을 수 없습니다')

    const work = await this.workRepo.findById(episode.workId)
    if (!work || work.authorId !== authorId) throw new ForbiddenException('에피소드 삭제 권한이 없습니다')

    await this.workRepo.deleteEpisode(episodeId)
  }

  /** 에피소드 상태 변경 (작가 소유권 검증) */
  async updateEpisodeStatus(authorId: string, episodeId: string, status: EpisodeStatus): Promise<Episode> {
    const episode = await this.workRepo.findEpisodeById(episodeId)
    if (!episode) throw new NotFoundException('에피소드를 찾을 수 없습니다')

    const work = await this.workRepo.findById(episode.workId)
    if (!work || work.authorId !== authorId) throw new ForbiddenException('에피소드 수정 권한이 없습니다')

    // shared 상태로 직접 변경 불가 — createShareLink 사용
    if (status === 'shared') throw new BadRequestException('공유 링크 생성은 별도 API를 사용하세요')

    // 첫 퍼블리시 보너스 — upload→public 최초 전환 시 2크레딧
    if (episode.status === 'upload' && status === 'public') {
      const allEpisodes = await this.workRepo.findEpisodesFiltered(work.id, [])
      const hasPublished = allEpisodes.some(ep => ep.status === 'public')
      if (!hasPublished) {
        await this.creditUseCase.grant(authorId, 2, CreditReason.FIRST_WORK_BONUS)
      }
    }

    // shared → 다른 상태로 변경 시 토큰 초기화
    const clearToken = episode.status === 'shared'
    return this.workRepo.updateEpisodeStatus(
      episodeId,
      status,
      clearToken ? null : undefined,
      clearToken ? null : undefined,
    )
  }

  /** 공유 링크 생성 (작가 소유권 검증) */
  async createShareLink(
    authorId: string,
    episodeId: string,
    expireIn: '12h' | '24h' | '48h' | 'never',
  ): Promise<{ sharedToken: string; sharedUrl: string; expireAt: Date | null }> {
    const episode = await this.workRepo.findEpisodeById(episodeId)
    if (!episode) throw new NotFoundException('에피소드를 찾을 수 없습니다')

    const work = await this.workRepo.findById(episode.workId)
    if (!work || work.authorId !== authorId) throw new ForbiddenException('공유 링크 생성 권한이 없습니다')

    const sharedToken = randomBytes(24).toString('hex')

    let expireAt: Date | null = null
    if (expireIn !== 'never') {
      const hours = parseInt(expireIn)
      expireAt = new Date(Date.now() + hours * 60 * 60 * 1000)
    }

    await this.workRepo.updateEpisodeStatus(episodeId, 'shared', sharedToken, expireAt)

    const baseUrl = process.env.CORS_ORIGIN || 'http://localhost:3001'
    return {
      sharedToken,
      sharedUrl: `${baseUrl}/shared/${sharedToken}`,
      expireAt,
    }
  }

  /** 공유 토큰으로 에피소드 조회 (만료 체크) */
  async getEpisodeBySharedToken(token: string): Promise<Episode> {
    const episode = await this.workRepo.findBySharedToken(token)
    if (!episode) throw new NotFoundException('공유 링크를 찾을 수 없습니다')

    if (episode.sharedExpireAt && new Date() > episode.sharedExpireAt) {
      throw new ForbiddenException('이 공유 링크는 만료되었습니다. 로그인 하십시오.')
    }

    return episode
  }

  /** 지원하는 텍스트 기반 포맷 */
  private static readonly SUPPORTED_TEXT_FORMATS = new Set(['md', 'markdown', 'txt', 'html'])

  /** rawContent를 Block[]으로 변환 + frontmatter 메타 추출 */
  private parseContentWithMeta(rawContent: string, sourceFormat?: string): { blocks: Block[]; meta?: { slug?: string; subtitle?: string; description?: string; type?: string } } {
    // 미지원 포맷 검증 (pdf, docx 등은 텍스트 파싱 불가 — 별도 파일 업로드 경로 사용)
    if (sourceFormat && !WorkManagementUseCase.SUPPORTED_TEXT_FORMATS.has(sourceFormat)) {
      throw new BadRequestException(`미지원 포맷: ${sourceFormat}. 지원: md, txt, html`)
    }
    const format = sourceFormat || this.detectFormat(rawContent)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { normalizeBlocks } = require('../../lib/block-normalizer')

    if (format === 'html') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { parseHtml } = require('../../lib/html-parser')
      const { blocks } = parseHtml(rawContent)
      return { blocks: normalizeBlocks(blocks) }
    }

    if (format === 'txt') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { parseTxt } = require('../../lib/txt-parser')
      const { blocks } = parseTxt(rawContent)
      return { blocks: normalizeBlocks(blocks) }
    }

    // markdown (기본)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mdParser = require('../../lib/md-parser')

    // frontmatter 파싱 → 메타 + 본문 분리
    let body = rawContent
    let meta: { slug?: string; subtitle?: string; description?: string; type?: string } | undefined
    try {
      const parsed = mdParser.parseFrontmatter(rawContent)
      body = parsed.body
      meta = { slug: parsed.meta.slug, subtitle: parsed.meta.subtitle, description: parsed.meta.description, type: parsed.meta.type }
    } catch {
      const match = rawContent.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
      if (match) body = match[1]
    }

    const { blocks } = mdParser.parseEpisodeBlocks(body)
    return { blocks: normalizeBlocks(blocks), meta }
  }

  /** 콘텐츠 포맷 자동 감지 */
  private detectFormat(content: string): string {
    if (/<\/?[a-z][\s\S]*>/i.test(content) && !content.startsWith('---')) return 'html'
    if (content.startsWith('---') || /^#{1,6}\s/m.test(content)) return 'markdown'
    return 'txt'
  }
}
