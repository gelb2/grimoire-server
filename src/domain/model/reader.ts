export interface Bookmark {
  id: string
  authorId: string
  episodeId: string
  createdAt: Date
}

export interface ReadingProgress {
  id: string
  authorId: string
  episodeId: string
  blockIndex: number
  updatedAt: Date
}

/** 서재 항목 — 북마크된 작품 + 읽기 진행도 + 구독 상태 */
export interface LibraryItem {
  workId: string
  workTitle: string
  workSlug: string
  authorName: string
  authorSlug: string
  episodeCount: number
  readEpisodeCount: number
  lastReadEpisodeTitle: string | null
  lastReadEpisodeSlug: string | null
  subscribed: boolean
}

/** 구독 작가의 최신 작품 */
export interface SubscribedWork {
  workId: string
  workTitle: string
  workSlug: string
  authorName: string
  authorSlug: string
  episodeCount: number
  latestEpisodeTitle: string | null
  createdAt: Date
}
