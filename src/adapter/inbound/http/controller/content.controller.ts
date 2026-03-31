import { Controller, Get, Param } from '@nestjs/common'
import { ContentUseCase } from '@application/content/content.usecase'

@Controller()
export class ContentController {
  constructor(private readonly contentUseCase: ContentUseCase) {}

  @Get('works/:authorSlug/:workSlug')
  async getWork(
    @Param('authorSlug') authorSlug: string,
    @Param('workSlug') workSlug: string,
  ) {
    return this.contentUseCase.getWorkDetail(authorSlug, workSlug)
  }

  @Get('episodes/:authorSlug/:workSlug/:episodeSlug')
  async getEpisode(
    @Param('authorSlug') authorSlug: string,
    @Param('workSlug') workSlug: string,
    @Param('episodeSlug') episodeSlug: string,
  ) {
    const episode = await this.contentUseCase.getEpisode(authorSlug, workSlug, episodeSlug)
    // 내부 필드 제거 — rawMd(원본 마크다운), workId(내부 UUID) 미노출
    const { rawMd, workId, ...safe } = episode as any
    return safe
  }
}
