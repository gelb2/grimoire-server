import { Injectable, Inject, BadRequestException, NotFoundException, Optional } from '@nestjs/common'
import { SocialRepositoryPort } from '@domain/port/outbound/social-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditLedgerPort } from '@domain/port/outbound/credit-ledger.port'
import { Subscription, Comment, AnonymousCommentInput } from '@domain/model/social'
import { GIFT_POINT_OPTIONS, isGiftPointOption } from '@domain/model/gift-points'

@Injectable()
export class SocialUseCase {
  constructor(
    @Inject('SocialRepositoryPort') private readonly socialRepo: SocialRepositoryPort,
    @Inject('CreditRepositoryPort') private readonly creditRepo: CreditRepositoryPort,
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    /**
     * CC-2b — 응원 선물 신 경로 (CreditLedgerPort.transfer).
     * Optional — 미주입 시 구 `creditRepo.giftTransfer` 폴백(BACKWARD COMPATIBLE,
     * 단 운영 app.module 에서는 항상 주입 — CC-3 후 폴백 제거).
     */
    @Optional()
    @Inject('CreditLedgerPort')
    private readonly ledger: CreditLedgerPort | null = null,
  ) {}

  // ── 좋아요 (로그인) ──

  async toggleLike(authorId: string, episodeId: string): Promise<{ liked: boolean; likeCount: number }> {
    return this.socialRepo.toggleLike(authorId, episodeId)
  }

  async getLikeCount(episodeId: string): Promise<number> {
    return this.socialRepo.getLikeCount(episodeId)
  }

  // ── 좋아요 (익명) ──

  /** 익명 좋아요 — 취소 불가, 중복 시 409 */
  async anonymousLike(episodeId: string, ipAddress: string, cookieId: string): Promise<{ liked: boolean; likeCount: number }> {
    const result = await this.socialRepo.createAnonymousLike({ episodeId, ipAddress, cookieId })
    return { liked: true, likeCount: result.likeCount }
  }

  /** 좋아요 상태 확인 (로그인/비로그인 분기) */
  async getLikeStatus(episodeId: string, authorId?: string, ipAddress?: string, cookieId?: string): Promise<{ liked: boolean; likeCount: number }> {
    const likeCount = await this.socialRepo.getLikeCount(episodeId)
    let liked = false

    if (authorId) {
      liked = await this.socialRepo.isLiked(authorId, episodeId)
    } else if (ipAddress && cookieId) {
      liked = await this.socialRepo.isAnonymousLiked(ipAddress, cookieId, episodeId)
    }

    return { liked, likeCount }
  }

  // ── 구독 ──

  async toggleSubscription(subscriberId: string, targetAuthorId: string): Promise<{ subscribed: boolean }> {
    return this.socialRepo.toggleSubscription(subscriberId, targetAuthorId)
  }

  async getSubscriptions(subscriberId: string): Promise<Subscription[]> {
    return this.socialRepo.getSubscriptions(subscriberId)
  }

  async getSubscriberCount(targetAuthorId: string): Promise<number> {
    return this.socialRepo.getSubscriberCount(targetAuthorId)
  }

  // ── 댓글 (로그인) ──

  async createComment(authorId: string, episodeId: string, content: string, parentId?: string): Promise<Comment> {
    this.validateCommentContent(content)
    const sanitized = this.escapeHtml(content.trim())
    return this.socialRepo.createComment(authorId, episodeId, sanitized, parentId)
  }

  async getComments(episodeId: string): Promise<Comment[]> {
    return this.socialRepo.getComments(episodeId)
  }

  async deleteComment(commentId: string, authorId: string): Promise<void> {
    return this.socialRepo.deleteComment(commentId, authorId)
  }

  // ── 댓글 (익명) ──

  /** 익명 댓글 작성 — 닉네임 + 비밀번호 필수 */
  async createAnonymousComment(input: AnonymousCommentInput): Promise<Comment> {
    this.validateCommentContent(input.content)
    if (!input.nickname || input.nickname.trim().length < 2 || input.nickname.trim().length > 20) {
      throw new BadRequestException('닉네임은 2~20자로 입력해주세요')
    }
    if (!input.password || input.password.length < 4 || input.password.length > 20) {
      throw new BadRequestException('비밀번호는 4~20자로 입력해주세요')
    }
    const sanitizedContent = this.escapeHtml(input.content.trim())
    const sanitizedNickname = this.escapeHtml(input.nickname.trim())
    return this.socialRepo.createAnonymousComment({
      ...input,
      content: sanitizedContent,
      nickname: sanitizedNickname,
    })
  }

  /** 익명 댓글 삭제 — 비밀번호 확인 */
  async deleteAnonymousComment(commentId: string, password: string): Promise<void> {
    return this.socialRepo.deleteAnonymousComment(commentId, password)
  }

  // ── 크레딧 선물 ──

  /**
   * 응원 선물 (작가 slug 기반) — CC-2b 신 경로 (案 G1).
   *
   * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §1-B
   *       .claude/state/sprint-cc2b-gift-refund-wiring-plan-draft.md §3
   *
   * body `amount` 단위 = **pt** (1,000/3,000/5,000pt 3단계 — `GIFT_POINT_OPTIONS` 정본,
   * 메인 §6 결정 박제). `CreditLedgerPort.transfer` 가 양측 작가 1 트랜잭션 이동.
   * 구 `creditRepo.giftTransfer` 폴백은 `ledger` 미주입 시(테스트용)만.
   */
  async giftCredits(
    senderId: string,
    receiverSlug: string,
    amount: number,
  ): Promise<{
    senderSpentBySource: Record<'free' | 'subscription' | 'gift' | 'charged', number>
    receiverGiftBalance: number
  }> {
    if (!isGiftPointOption(amount)) {
      throw new BadRequestException(
        `선물 금액은 ${GIFT_POINT_OPTIONS.join(', ')}pt 중 하나여야 합니다`,
      )
    }

    const receiver = await this.authorRepo.findBySlug(receiverSlug)
    if (!receiver) {
      throw new NotFoundException('작가를 찾을 수 없습니다')
    }

    if (senderId === receiver.id) {
      throw new BadRequestException('자기 자신에게 선물할 수 없습니다')
    }

    if (!this.ledger) {
      throw new BadRequestException('포인트 원장이 구성되지 않았습니다')
    }

    try {
      return await this.ledger.transfer(senderId, receiver.id, amount, undefined)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      if (message.includes('포인트가 부족') || message.includes('크레딧이 부족')) {
        throw new BadRequestException('포인트가 부족합니다')
      }
      throw e
    }
  }

  // ── 내부 유틸 ──

  private validateCommentContent(content: string): void {
    if (!content || content.trim().length === 0) {
      throw new BadRequestException('댓글 내용을 입력해주세요')
    }
    if (content.length > 500) {
      throw new BadRequestException('댓글은 500자 이내로 작성해주세요')
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
  }
}
