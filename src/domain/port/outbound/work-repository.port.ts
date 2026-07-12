import { Work, Episode, EpisodeSummary, WorkWithMeta, EpisodeStatus } from '@domain/model/work'
import { Block } from '@domain/model/block'

export interface WorkRepositoryPort {
  findByAuthorSlug(authorSlug: string): Promise<Work[]>
  findById(id: string): Promise<Work | null>
  findByAuthorAndWorkSlug(authorSlug: string, workSlug: string): Promise<Work | null>
  findEpisodes(workId: string): Promise<EpisodeSummary[]>
  findEpisode(authorSlug: string, workSlug: string, episodeSlug: string): Promise<Episode | null>
  findEpisodeById(id: string): Promise<Episode | null>
  createWork(input: { authorId: string; slug: string; title: string; subtitle?: string; description?: string }): Promise<Work>
  updateWork(id: string, input: { title?: string; subtitle?: string; description?: string; coverImage?: string | null; context?: string | null; instructions?: string | null }): Promise<Work>
  deleteWork(id: string): Promise<void>
  createEpisode(input: {
    workId: string
    slug: string
    title: string
    subtitle?: string
    description?: string
    type?: string
    orderNum: number
    blocks: Block[]
    rawMd: string
    sourceFormat?: string
  }): Promise<Episode>
  deleteEpisode(id: string): Promise<void>
  updateEpisodeIndexed(id: string, isIndexed: boolean): Promise<void>
  countByAuthorId(authorId: string): Promise<number>
  countEpisodesByWorkId(workId: string): Promise<number>
  /** 제목으로 작품 검색 (LIKE) */
  searchByTitle(query: string, limit: number): Promise<Work[]>
  /** 인기 작품 조회 (viewCount 내림차순) */
  findPopular(limit: number): Promise<WorkWithMeta[]>
  /** 최신 작품 조회 (createdAt 내림차순) */
  findRecent(limit: number): Promise<WorkWithMeta[]>
  /** 인기 작품 페이지네이션 조회 */
  findPopularPaginated(page: number, pageSize: number): Promise<{ works: WorkWithMeta[]; totalCount: number }>
  /** 최신 작품 페이지네이션 조회 */
  findRecentPaginated(page: number, pageSize: number): Promise<{ works: WorkWithMeta[]; totalCount: number }>
  /** 전체 작품 수 */
  countAll(): Promise<number>
  /** 전체 에피소드 수 */
  countAllEpisodes(): Promise<number>
  /** 에피소드 상태 변경 */
  updateEpisodeStatus(id: string, status: EpisodeStatus, sharedToken?: string | null, sharedExpireAt?: Date | null): Promise<Episode>
  /** 공유 토큰으로 에피소드 조회 */
  findBySharedToken(token: string): Promise<Episode | null>
  /** 특정 에피소드 목록 조회 (status 필터링 포함) */
  findEpisodesFiltered(workId: string, excludeStatuses?: EpisodeStatus[]): Promise<EpisodeSummary[]>
  /**
   * 에피소드 순서 일괄 재부여 (F-20 — 기획 §13).
   *
   * `orderedEpisodeIds[i]` 의 `orderNum` 을 `i+1` 로 원자 재부여한다.
   * Episode.orderNum 은 unique 제약이 없어(`@@index([workId, orderNum])` 논유니크 인덱스)
   * 재부여 중 충돌이 발생하지 않으므로 임시 오프셋 없이 단일 `$transaction` 으로 직접 갱신.
   * 각 update 는 `{ id, workId }` 로 스코프해 다른 작품 에피소드 오염을 방어(집합 검증은 UseCase).
   */
  reorderEpisodes(workId: string, orderedEpisodeIds: string[]): Promise<void>
  /** 에피소드 내용 업데이트 (재업로드) */
  updateEpisodeContent(id: string, data: { title?: string; subtitle?: string; description?: string; blocks?: Block[]; rawMd?: string; sourceFormat?: string }): Promise<Episode>
  /** 작품 테마 배정 */
  updateWorkThemeId(workId: string, themeId: string | null): Promise<Work>
}
