import { Injectable, Inject, BadRequestException } from '@nestjs/common'
import { SocialRepositoryPort } from '@domain/port/outbound/social-repository.port'
import { Subscription, Comment } from '@domain/model/social'

@Injectable()
export class SocialUseCase {
  constructor(
    @Inject('SocialRepositoryPort') private readonly socialRepo: SocialRepositoryPort,
  ) {}

  // ── 좋아요 ──

  /** 좋아요 토글 — 있으면 취소, 없으면 추가 */
  async toggleLike(authorId: string, episodeId: string): Promise<{ liked: boolean; likeCount: number }> {
    return this.socialRepo.toggleLike(authorId, episodeId)
  }

  /** 에피소드 좋아요 수 조회 */
  async getLikeCount(episodeId: string): Promise<number> {
    return this.socialRepo.getLikeCount(episodeId)
  }

  // ── 구독 ──

  /** 구독 토글 — 있으면 해제, 없으면 구독 */
  async toggleSubscription(subscriberId: string, targetAuthorId: string): Promise<{ subscribed: boolean }> {
    return this.socialRepo.toggleSubscription(subscriberId, targetAuthorId)
  }

  /** 내 구독 목록 조회 */
  async getSubscriptions(subscriberId: string): Promise<Subscription[]> {
    return this.socialRepo.getSubscriptions(subscriberId)
  }

  /** 작가의 구독자 수 조회 */
  async getSubscriberCount(targetAuthorId: string): Promise<number> {
    return this.socialRepo.getSubscriberCount(targetAuthorId)
  }

  // ── 댓글 ──

  /** 댓글 작성 (내용 1~500자 검증) */
  async createComment(authorId: string, episodeId: string, content: string): Promise<Comment> {
    if (!content || content.trim().length === 0) {
      throw new BadRequestException('댓글 내용을 입력해주세요')
    }
    if (content.length > 500) {
      throw new BadRequestException('댓글은 500자 이내로 작성해주세요')
    }
    return this.socialRepo.createComment(authorId, episodeId, content.trim())
  }

  /** 에피소드 댓글 목록 조회 */
  async getComments(episodeId: string): Promise<Comment[]> {
    return this.socialRepo.getComments(episodeId)
  }

  /** 댓글 삭제 (작성자 본인만 가능) */
  async deleteComment(commentId: string, authorId: string): Promise<void> {
    return this.socialRepo.deleteComment(commentId, authorId)
  }
}
