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
    return this.contentUseCase.getEpisode(authorSlug, workSlug, episodeSlug)
  }
}
