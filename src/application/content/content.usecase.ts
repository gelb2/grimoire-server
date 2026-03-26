import { Injectable, Inject, NotFoundException } from '@nestjs/common'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { WorkDetail, Episode } from '@domain/model/work'

@Injectable()
export class ContentUseCase {
  constructor(
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
  ) {}

  async getWorkDetail(authorSlug: string, workSlug: string): Promise<WorkDetail> {
    const work = await this.workRepo.findByAuthorAndWorkSlug(authorSlug, workSlug)
    if (!work) {
      throw new NotFoundException('작품을 찾을 수 없습니다')
    }

    const episodes = await this.workRepo.findEpisodes(work.id)
    return { work, episodes }
  }

  async getEpisode(authorSlug: string, workSlug: string, episodeSlug: string): Promise<Episode> {
    const episode = await this.workRepo.findEpisode(authorSlug, workSlug, episodeSlug)
    if (!episode) {
      throw new NotFoundException('에피소드를 찾을 수 없습니다')
    }
    return episode
  }
}
