import { Work, Episode, EpisodeSummary, WorkWithMeta } from '@domain/model/work'
import { Block } from '@domain/model/block'

export interface WorkRepositoryPort {
  findByAuthorSlug(authorSlug: string): Promise<Work[]>
  findById(id: string): Promise<Work | null>
  findByAuthorAndWorkSlug(authorSlug: string, workSlug: string): Promise<Work | null>
  findEpisodes(workId: string): Promise<EpisodeSummary[]>
  findEpisode(authorSlug: string, workSlug: string, episodeSlug: string): Promise<Episode | null>
  findEpisodeById(id: string): Promise<Episode | null>
  createWork(input: { authorId: string; slug: string; title: string; subtitle?: string; description?: string }): Promise<Work>
  updateWork(id: string, input: { title?: string; subtitle?: string; description?: string; coverImage?: string | null }): Promise<Work>
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
}
