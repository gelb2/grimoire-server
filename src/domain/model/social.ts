/** 좋아요 */
export interface Like {
  id: string
  authorId: string
  episodeId: string
  createdAt: Date
}

/** 구독 */
export interface Subscription {
  id: string
  subscriberId: string
  targetAuthorId: string
  createdAt: Date
}

/** 댓글 */
export interface Comment {
  id: string
  authorId: string
  episodeId: string
  content: string
  parentId?: string
  createdAt: Date
}
