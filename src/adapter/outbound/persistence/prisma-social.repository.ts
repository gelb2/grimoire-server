import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { SocialRepositoryPort } from '@domain/port/outbound/social-repository.port'
import { Like, Subscription, Comment } from '@domain/model/social'

@Injectable()
export class PrismaSocialRepository implements SocialRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  // ── 좋아요 ──

  async toggleLike(authorId: string, episodeId: string): Promise<{ liked: boolean; likeCount: number }> {
    const existing = await this.prisma.like.findUnique({
      where: { authorId_episodeId: { authorId, episodeId } },
    })

    if (existing) {
      await this.prisma.like.delete({
        where: { id: existing.id },
      })
    } else {
      await this.prisma.like.create({
        data: { authorId, episodeId },
      })
    }

    const likeCount = await this.prisma.like.count({ where: { episodeId } })
    return { liked: !existing, likeCount }
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
    const existing = await this.prisma.subscription.findUnique({
      where: { subscriberId_targetAuthorId: { subscriberId, targetAuthorId } },
    })

    if (existing) {
      await this.prisma.subscription.delete({
        where: { id: existing.id },
      })
      return { subscribed: false }
    }

    await this.prisma.subscription.create({
      data: { subscriberId, targetAuthorId },
    })
    return { subscribed: true }
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

  async createComment(authorId: string, episodeId: string, content: string): Promise<Comment> {
    const row = await this.prisma.comment.create({
      data: { authorId, episodeId, content },
    })
    return toCommentDomain(row)
  }

  async getComments(episodeId: string): Promise<Comment[]> {
    const rows = await this.prisma.comment.findMany({
      where: { episodeId },
      orderBy: { createdAt: 'desc' },
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
}

function toSubscriptionDomain(row: { id: string; subscriberId: string; targetAuthorId: string; createdAt: Date }): Subscription {
  return { id: row.id, subscriberId: row.subscriberId, targetAuthorId: row.targetAuthorId, createdAt: row.createdAt }
}

function toCommentDomain(row: { id: string; authorId: string; episodeId: string; content: string; createdAt: Date }): Comment {
  return { id: row.id, authorId: row.authorId, episodeId: row.episodeId, content: row.content, createdAt: row.createdAt }
}
