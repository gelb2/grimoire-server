import { Block } from './block'

export interface Work {
  id: string
  authorId: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
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
  orderNum: number
}

export interface WorkDetail {
  work: Work
  episodes: EpisodeSummary[]
}
