import { Like, Subscription, Comment, AnonymousLikeInput, AnonymousCommentInput } from '@domain/model/social'

export interface SocialRepositoryPort {
  // ── 좋아요 (로그인) ──
  /** 좋아요 토글 (있으면 삭제, 없으면 생성) */
  toggleLike(authorId: string, episodeId: string): Promise<{ liked: boolean; likeCount: number }>
  /** 에피소드 좋아요 수 조회 */
  getLikeCount(episodeId: string): Promise<number>
  /** 좋아요 여부 확인 */
  isLiked(authorId: string, episodeId: string): Promise<boolean>

  // ── 좋아요 (익명) ──
  /** 익명 좋아요 생성 (취소 불가) */
  createAnonymousLike(input: AnonymousLikeInput): Promise<{ likeCount: number }>
  /** 익명 좋아요 여부 확인 */
  isAnonymousLiked(ipAddress: string, cookieId: string, episodeId: string): Promise<boolean>

  // ── 구독 ──
  /** 구독 토글 (있으면 해제, 없으면 구독) */
  toggleSubscription(subscriberId: string, targetAuthorId: string): Promise<{ subscribed: boolean }>
  /** 구독 목록 조회 */
  getSubscriptions(subscriberId: string): Promise<Subscription[]>
  /** 구독자 수 조회 */
  getSubscriberCount(targetAuthorId: string): Promise<number>
  /** 구독 여부 확인 */
  isSubscribed(subscriberId: string, targetAuthorId: string): Promise<boolean>

  // ── 댓글 (로그인) ──
  /** 댓글 작성 (parentId로 대댓글 지원) */
  createComment(authorId: string, episodeId: string, content: string, parentId?: string): Promise<Comment>
  /** 에피소드 댓글 목록 조회 */
  getComments(episodeId: string): Promise<Comment[]>
  /** 댓글 삭제 (작성자 확인) */
  deleteComment(id: string, authorId: string): Promise<void>
  /** 에피소드 댓글 수 조회 */
  getCommentCount(episodeId: string): Promise<number>

  // ── 댓글 (익명) ──
  /** 익명 댓글 작성 */
  createAnonymousComment(input: AnonymousCommentInput): Promise<Comment>
  /** 익명 댓글 삭제 (비밀번호 확인) */
  deleteAnonymousComment(id: string, password: string): Promise<void>

  /** 작가의 모든 에피소드에 대한 총 좋아요 수 조회 */
  getTotalLikesForAuthor(authorId: string): Promise<number>
}
