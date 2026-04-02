/** 좋아요 */
export interface Like {
  id: string
  authorId: string | null
  episodeId: string
  ipAddress?: string
  cookieId?: string
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
  authorId: string | null
  episodeId: string
  content: string
  nickname?: string
  ipAddress?: string
  parentId?: string
  createdAt: Date
}

/** 익명 좋아요 입력 */
export interface AnonymousLikeInput {
  episodeId: string
  ipAddress: string
  cookieId: string
}

/** 익명 댓글 입력 */
export interface AnonymousCommentInput {
  episodeId: string
  content: string
  nickname: string
  password: string
  ipAddress: string
  parentId?: string
}
