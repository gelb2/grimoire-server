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
