import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { SocialRepositoryPort } from '@domain/port/outbound/social-repository.port'
import { Like, Subscription, Comment } from '@domain/model/social'

@Injectable()
export class PrismaSocialRepository implements SocialRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  // ── 좋아요 ──

  async toggleLike(authorId: string, episodeId: string): Promise<{ liked: boolean; likeCount: number }> {
    // 트랜잭션으로 원자적 처리 — 동시 요청 시 중복 생성/삭제 방지
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.like.findUnique({
        where: { authorId_episodeId: { authorId, episodeId } },
      })

      if (existing) {
        await tx.like.delete({
          where: { id: existing.id },
        })
      } else {
        await tx.like.create({
          data: { authorId, episodeId },
        })
      }

      const likeCount = await tx.like.count({ where: { episodeId } })
      return { liked: !existing, likeCount }
    })
  }

  async getLikeCount(episodeId: string): Promise<number> {
    return this.prisma.like.count({ where: { episodeId } })
  }

  async isLiked(authorId: string, episodeId: string): Promise<boolean> {
    const count = await this.prisma.like.count({ where: { authorId, episodeId } })
    return count > 0
  }

  // ── 구독 ──

  async toggleSubscription(subscriberId: string, targetAuthorId: string): Promise<{ subscribed: boolean }> {
    // 트랜잭션으로 원자적 처리 — 동시 요청 시 중복 생성/삭제 방지
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscription.findUnique({
        where: { subscriberId_targetAuthorId: { subscriberId, targetAuthorId } },
      })

      if (existing) {
        await tx.subscription.delete({
          where: { id: existing.id },
        })
        return { subscribed: false }
      }

      await tx.subscription.create({
        data: { subscriberId, targetAuthorId },
      })
      return { subscribed: true }
    })
  }

  async getSubscriptions(subscriberId: string): Promise<Subscription[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { subscriberId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toSubscriptionDomain)
  }

  async getSubscriberCount(targetAuthorId: string): Promise<number> {
    return this.prisma.subscription.count({ where: { targetAuthorId } })
  }

  async isSubscribed(subscriberId: string, targetAuthorId: string): Promise<boolean> {
    const count = await this.prisma.subscription.count({ where: { subscriberId, targetAuthorId } })
    return count > 0
  }

  // ── 댓글 ──

  async createComment(authorId: string, episodeId: string, content: string, parentId?: string): Promise<Comment> {
    const data: { authorId: string; episodeId: string; content: string; parentId?: string } = { authorId, episodeId, content }
    if (parentId) {
      // 대댓글 깊이 제한 (2depth까지) — 부모가 이미 대댓글이면 거부
      const parent = await this.prisma.comment.findUnique({ where: { id: parentId } })
      if (!parent) {
        throw new NotFoundException('부모 댓글을 찾을 수 없습니다')
      }
      if (parent.parentId) {
        // 부모가 이미 대댓글 → 부모의 부모에 달기 (2depth 제한)
        data.parentId = parent.parentId
      } else {
        data.parentId = parentId
      }
    }
    const row = await this.prisma.comment.create({ data })
    return toCommentDomain(row)
  }

  async getComments(episodeId: string): Promise<Comment[]> {
    const rows = await this.prisma.comment.findMany({
      where: { episodeId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toCommentDomain)
  }

  async deleteComment(id: string, authorId: string): Promise<void> {
    const comment = await this.prisma.comment.findUnique({ where: { id } })
    if (!comment) {
      throw new NotFoundException('댓글을 찾을 수 없습니다')
    }
    if (comment.authorId !== authorId) {
      throw new ForbiddenException('본인의 댓글만 삭제할 수 있습니다')
    }
    await this.prisma.comment.delete({ where: { id } })
  }

  async getCommentCount(episodeId: string): Promise<number> {
    return this.prisma.comment.count({ where: { episodeId } })
  }

  /** 작가의 모든 에피소드에 대한 총 좋아요 수 — 작가의 작품 → 에피소드 → 좋아요 집계 */
  async getTotalLikesForAuthor(authorId: string): Promise<number> {
    const episodes = await this.prisma.episode.findMany({
      where: { work: { authorId } },
      select: { id: true },
    })
    if (episodes.length === 0) return 0
    return this.prisma.like.count({
      where: { episodeId: { in: episodes.map(e => e.id) } },
    })
  }
}

function toSubscriptionDomain(row: { id: string; subscriberId: string; targetAuthorId: string; createdAt: Date }): Subscription {
  return { id: row.id, subscriberId: row.subscriberId, targetAuthorId: row.targetAuthorId, createdAt: row.createdAt }
}

function toCommentDomain(row: { id: string; authorId: string; episodeId: string; content: string; parentId?: string | null; createdAt: Date }): Comment {
  return { id: row.id, authorId: row.authorId, episodeId: row.episodeId, content: row.content, parentId: row.parentId ?? undefined, createdAt: row.createdAt }
}
