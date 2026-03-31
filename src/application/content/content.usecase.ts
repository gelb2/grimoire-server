import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { StatsRepositoryPort } from '@domain/port/outbound/stats-repository.port'
import { WorkDetail, Episode } from '@domain/model/work'

@Injectable()
export class ContentUseCase {
  constructor(
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('StatsRepositoryPort') private readonly statsRepo: StatsRepositoryPort,
  ) {}

  /** 작품 상세 조회 — authorId가 있으면 작가 본인(upload 포함), 없으면 public만 */
  async getWorkDetail(authorSlug: string, workSlug: string, requestAuthorId?: string): Promise<WorkDetail> {
    const work = await this.workRepo.findByAuthorAndWorkSlug(authorSlug, workSlug)
    if (!work) {
      throw new NotFoundException('작품을 찾을 수 없습니다')
    }

    const isOwner = requestAuthorId && work.authorId === requestAuthorId

    // 작가 본인이면 모든 에피소드, 아니면 upload 제외
    const episodes = isOwner
      ? await this.workRepo.findEpisodes(work.id)
      : await this.workRepo.findEpisodesFiltered(work.id, ['upload'])

    return { work, episodes }
  }

  /** 에피소드 조회 — status별 접근 제어 */
  async getEpisode(authorSlug: string, workSlug: string, episodeSlug: string, requestAuthorId?: string): Promise<Episode> {
    const episode = await this.workRepo.findEpisode(authorSlug, workSlug, episodeSlug)
    if (!episode) {
      throw new NotFoundException('에피소드를 찾을 수 없습니다')
    }

    // 작가 본인 확인
    const work = await this.workRepo.findByAuthorAndWorkSlug(authorSlug, workSlug)
    const isOwner = requestAuthorId && work && work.authorId === requestAuthorId

    // status 기반 접근 제어
    switch (episode.status) {
      case 'upload':
        if (!isOwner) throw new ForbiddenException('아직 공개되지 않은 에피소드입니다')
        break
      case 'nonPublic':
        if (!requestAuthorId) throw new ForbiddenException('로그인이 필요합니다')
        break
      case 'shared':
        // shared 상태는 공유 토큰으로만 접근 — 일반 URL 접근 시 로그인 필요
        if (!isOwner && !requestAuthorId) throw new ForbiddenException('로그인이 필요합니다')
        break
      case 'public':
      default:
        break
    }

    // 비동기로 조회수 기록 (에피소드 응답에 영향 없음)
    this.statsRepo.incrementDailyView(episode.workId, new Date()).catch(() => {
      // 조회수 기록 실패해도 에피소드 조회는 정상 동작
    })

    return episode
  }
}
