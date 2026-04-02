import { Injectable, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { SocialRepositoryPort } from '@domain/port/outbound/social-repository.port'
import { Like, Subscription, Comment, AnonymousLikeInput, AnonymousCommentInput } from '@domain/model/social'

const BCRYPT_ROUNDS = 10

@Injectable()
export class PrismaSocialRepository implements SocialRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  // ── 좋아요 (로그인) ──

  async toggleLike(authorId: string, episodeId: string): Promise<{ liked: boolean; likeCount: number }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.like.findFirst({
        where: { authorId, episodeId },
      })

      if (existing) {
        await tx.like.delete({ where: { id: existing.id } })
      } else {
        await tx.like.create({ data: { authorId, episodeId } })
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

  // ── 좋아요 (익명) ──

  async createAnonymousLike(input: AnonymousLikeInput): Promise<{ likeCount: number }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.like.findFirst({
        where: { ipAddress: input.ipAddress, cookieId: input.cookieId, episodeId: input.episodeId },
      })

      if (existing) {
        throw new ConflictException('이미 좋아요를 눌렀습니다')
      }

      await tx.like.create({
        data: {
          episodeId: input.episodeId,
          ipAddress: input.ipAddress,
          cookieId: input.cookieId,
        },
      })

      const likeCount = await tx.like.count({ where: { episodeId: input.episodeId } })
      return { likeCount }
    })
  }

  async isAnonymousLiked(ipAddress: string, cookieId: string, episodeId: string): Promise<boolean> {
    const count = await this.prisma.like.count({
      where: { ipAddress, cookieId, episodeId },
    })
    return count > 0
  }

  // ── 구독 ──

  async toggleSubscription(subscriberId: string, targetAuthorId: string): Promise<{ subscribed: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscription.findUnique({
        where: { subscriberId_targetAuthorId: { subscriberId, targetAuthorId } },
      })

      if (existing) {
        await tx.subscription.delete({ where: { id: existing.id } })
        return { subscribed: false }
      }

      await tx.subscription.create({ data: { subscriberId, targetAuthorId } })
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

  // ── 댓글 (로그인) ──

  async createComment(authorId: string, episodeId: string, content: string, parentId?: string): Promise<Comment> {
    const resolvedParentId = await this.resolveParentId(parentId)
    const row = await this.prisma.comment.create({
      data: { authorId, episodeId, content, parentId: resolvedParentId },
    })
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

  // ── 댓글 (익명) ──

  async createAnonymousComment(input: AnonymousCommentInput): Promise<Comment> {
    const resolvedParentId = await this.resolveParentId(input.parentId)
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
    const row = await this.prisma.comment.create({
      data: {
        episodeId: input.episodeId,
        content: input.content,
        nickname: input.nickname,
        passwordHash,
        ipAddress: input.ipAddress,
        parentId: resolvedParentId,
      },
    })
    return toCommentDomain(row)
  }

  async deleteAnonymousComment(id: string, password: string): Promise<void> {
    const comment = await this.prisma.comment.findUnique({ where: { id } })
    if (!comment) {
      throw new NotFoundException('댓글을 찾을 수 없습니다')
    }
    if (!comment.passwordHash) {
      throw new ForbiddenException('익명 댓글이 아닙니다')
    }
    const isValid = await bcrypt.compare(password, comment.passwordHash)
    if (!isValid) {
      throw new ForbiddenException('비밀번호가 일치하지 않습니다')
    }
    await this.prisma.comment.delete({ where: { id } })
  }

  /** 작가의 모든 에피소드에 대한 총 좋아요 수 */
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

  // ── 내부 유틸 ──

  /** 대댓글 깊이 제한 (2depth) — 부모가 이미 대댓글이면 부모의 부모에 달기 */
  private async resolveParentId(parentId?: string): Promise<string | undefined> {
    if (!parentId) return undefined
    const parent = await this.prisma.comment.findUnique({ where: { id: parentId } })
    if (!parent) {
      throw new NotFoundException('부모 댓글을 찾을 수 없습니다')
    }
    return parent.parentId ?? parentId
  }
}

function toSubscriptionDomain(row: { id: string; subscriberId: string; targetAuthorId: string; createdAt: Date }): Subscription {
  return { id: row.id, subscriberId: row.subscriberId, targetAuthorId: row.targetAuthorId, createdAt: row.createdAt }
}

function toCommentDomain(row: {
  id: string; authorId: string | null; episodeId: string; content: string;
  nickname: string | null; parentId: string | null; createdAt: Date
}): Comment {
  return {
    id: row.id,
    authorId: row.authorId,
    episodeId: row.episodeId,
    content: row.content,
    nickname: row.nickname ?? undefined,
    parentId: row.parentId ?? undefined,
    createdAt: row.createdAt,
  }
}
