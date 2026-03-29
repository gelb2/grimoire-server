import { Injectable, Inject, ForbiddenException, NotFoundException } from '@nestjs/common'
import { StatsRepositoryPort } from '@domain/port/outbound/stats-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { WorkStats } from '@domain/model/stats'

@Injectable()
export class StatsUseCase {
  constructor(
    @Inject('StatsRepositoryPort') private readonly statsRepo: StatsRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
  ) {}

  /** 에피소드 조회 시 일별 조회수 증가 */
  async recordView(workId: string): Promise<void> {
    await this.statsRepo.incrementDailyView(workId, new Date())
  }

  /** 작품 조회수 통계 조회 (소유자만) */
  async getWorkStats(authorId: string, workId: string): Promise<WorkStats> {
    const work = await this.workRepo.findById(workId)
    if (!work) throw new NotFoundException('작품을 찾을 수 없습니다')
    if (work.authorId !== authorId) throw new ForbiddenException('통계 조회 권한이 없습니다')

    const dailyViews = await this.statsRepo.getDailyViews(workId, 30)
    const totalViews = dailyViews.reduce((sum, d) => sum + d.count, 0)

    return {
      dates: dailyViews.map(d => d.date),
      counts: dailyViews.map(d => d.count),
      totalViews,
    }
  }
}
