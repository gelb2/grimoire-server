import { Block } from './block'

/** 에피소드 상태값: upload(업로드만)/public(공개)/nonPublic(비공개)/shared(공유링크) */
export type EpisodeStatus = 'upload' | 'public' | 'nonPublic' | 'shared'

export interface Work {
  id: string
  authorId: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  coverImage: string | null
  context: string | null
  instructions: string | null
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
  description: string | null
  type: string
  orderNum: number
  blocks: Block[]
  rawMd: string
  viewCount: number
  sourceFormat: string
  isIndexed: boolean
  status: EpisodeStatus
  sharedToken: string | null
  sharedExpireAt: Date | null
  createdAt: Date
}

/** 에피소드 + 네비게이션 정보 (API 응답용) */
export interface EpisodeWithNav extends Episode {
  prevSlug: string | null
  nextSlug: string | null
  authorName: string
  workTitle: string
}

export interface EpisodeSummary {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  type: string
  orderNum: number
  status: EpisodeStatus
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
