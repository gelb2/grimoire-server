import { Block } from './block'

export interface Work {
  id: string
  authorId: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  coverImage: string | null
  themeId: string | null
  viewCount: number
  createdAt: Date
}

/** 인기/최신 작품 조회 결과 (작가 정보 + 에피소드 수 포함) */
export interface WorkWithMeta extends Work {
  authorName: string
  authorSlug: string
  episodeCount: number
}

export interface Episode {
  id: string
  workId: string
  slug: string
  title: string
  subtitle: string | null
  type: string
  orderNum: number
  blocks: Block[]
  rawMd: string
  createdAt: Date
}

export interface EpisodeSummary {
  id: string
  slug: string
  title: string
  subtitle: string | null
  type: string
  orderNum: number
}

export interface WorkDetail {
  work: Work
  episodes: EpisodeSummary[]
}

/** 페이지네이션 응답 */
export interface PaginatedWorks {
  works: WorkWithMeta[]
  totalCount: number
  page: number
  pageSize: number
  hasMore: boolean
}
