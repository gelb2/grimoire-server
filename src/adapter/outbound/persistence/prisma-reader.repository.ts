import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { ReaderRepositoryPort } from '@domain/port/outbound/reader-repository.port'
import { Bookmark, ReadingProgress, LibraryItem, SubscribedWork } from '@domain/model/reader'

@Injectable()
export class PrismaReaderRepository implements ReaderRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async getBookmarks(authorId: string): Promise<Bookmark[]> {
    const rows = await this.prisma.bookmark.findMany({
      where: { authorId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toBookmarkDomain)
  }

  async addBookmark(authorId: string, episodeId: string): Promise<Bookmark> {
    const row = await this.prisma.bookmark.create({
      data: { authorId, episodeId },
    })
    return toBookmarkDomain(row)
  }

  async removeBookmark(authorId: string, episodeId: string): Promise<void> {
    await this.prisma.bookmark.delete({
      where: { authorId_episodeId: { authorId, episodeId } },
    })
  }

  async isBookmarked(authorId: string, episodeId: string): Promise<boolean> {
    const count = await this.prisma.bookmark.count({
      where: { authorId, episodeId },
    })
    return count > 0
  }

  async getProgress(authorId: string, episodeId: string): Promise<ReadingProgress | null> {
    const row = await this.prisma.readingProgress.findUnique({
      where: { authorId_episodeId: { authorId, episodeId } },
    })
    return row ? toProgressDomain(row) : null
  }

  async saveProgress(authorId: string, episodeId: string, blockIndex: number): Promise<ReadingProgress> {
    const row = await this.prisma.readingProgress.upsert({
      where: { authorId_episodeId: { authorId, episodeId } },
      create: { authorId, episodeId, blockIndex },
      update: { blockIndex },
    })
    return toProgressDomain(row)
  }

  /** 서재 조회 — 북마크된 에피소드를 작품별로 그룹화하여 반환 */
  async getLibrary(userId: string): Promise<LibraryItem[]> {
    // 북마크된 에피소드 목록 (작품·작가 정보 포함)
    const bookmarks = await this.prisma.bookmark.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: 'desc' },
    })

    if (bookmarks.length === 0) return []

    const episodeIds = bookmarks.map(b => b.episodeId)

    // 에피소드 + 작품 + 작가 정보 조회
    const episodes = await this.prisma.episode.findMany({
      where: { id: { in: episodeIds } },
      include: {
        work: {
          include: {
            author: { select: { name: true, slug: true, id: true } },
            _count: { select: { episodes: true } },
          },
        },
      },
    })

    // 읽기 진행도 조회
    const progressRows = await this.prisma.readingProgress.findMany({
      where: { authorId: userId, episodeId: { in: episodeIds } },
    })
    const progressMap = new Map(progressRows.map(p => [p.episodeId, p]))

    // 구독 목록 조회
    const subscriptions = await this.prisma.subscription.findMany({
      where: { subscriberId: userId },
    })
    const subscribedAuthorIds = new Set(subscriptions.map(s => s.targetAuthorId))

    // 작품별로 그룹화
    const workMap = new Map<string, {
      work: typeof episodes[0]['work']
      episodeIds: string[]
    }>()

    for (const ep of episodes) {
      if (!workMap.has(ep.workId)) {
        workMap.set(ep.workId, { work: ep.work, episodeIds: [] })
      }
      workMap.get(ep.workId)!.episodeIds.push(ep.id)
    }

    // 각 작품의 읽기 진행도가 있는 에피소드 수 + 마지막 읽은 에피소드 조회
    const result: LibraryItem[] = []

    for (const [workId, { work, episodeIds: bookmarkedEpIds }] of workMap) {
      // 해당 작품에서 읽기 진행도가 있는 에피소드 조회
      const readProgressInWork = await this.prisma.readingProgress.findMany({
        where: { authorId: userId, episodeId: { in: bookmarkedEpIds } },
        orderBy: { updatedAt: 'desc' },
      })

      let lastReadEpisodeTitle: string | null = null
      let lastReadEpisodeSlug: string | null = null

      if (readProgressInWork.length > 0) {
        const lastReadEp = await this.prisma.episode.findUnique({
          where: { id: readProgressInWork[0].episodeId },
          select: { title: true, slug: true },
        })
        lastReadEpisodeTitle = lastReadEp?.title ?? null
        lastReadEpisodeSlug = lastReadEp?.slug ?? null
      }

      result.push({
        workId,
        workTitle: work.title,
        workSlug: work.slug,
        authorName: work.author.name,
        authorSlug: work.author.slug,
        episodeCount: work._count.episodes,
        readEpisodeCount: readProgressInWork.length,
        lastReadEpisodeTitle,
        lastReadEpisodeSlug,
        subscribed: subscribedAuthorIds.has(work.author.id),
      })
    }

    return result
  }

  /** 구독 작가의 최신 작품 조회 */
  async getSubscribedWorks(userId: string): Promise<SubscribedWork[]> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { subscriberId: userId },
    })

    if (subscriptions.length === 0) return []

    const authorIds = subscriptions.map(s => s.targetAuthorId)

    const works = await this.prisma.work.findMany({
      where: { authorId: { in: authorIds } },
      include: {
        author: { select: { name: true, slug: true } },
        _count: { select: { episodes: true } },
        episodes: {
          orderBy: { orderNum: 'desc' },
          take: 1,
          select: { title: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return works.map(w => ({
      workId: w.id,
      workTitle: w.title,
      workSlug: w.slug,
      authorName: w.author.name,
      authorSlug: w.author.slug,
      episodeCount: w._count.episodes,
      latestEpisodeTitle: w.episodes[0]?.title ?? null,
      createdAt: w.createdAt,
    }))
  }
}

function toBookmarkDomain(row: { id: string; authorId: string; episodeId: string; createdAt: Date }): Bookmark {
  return { id: row.id, authorId: row.authorId, episodeId: row.episodeId, createdAt: row.createdAt }
}

function toProgressDomain(row: { id: string; authorId: string; episodeId: string; blockIndex: number; updatedAt: Date }): ReadingProgress {
  return { id: row.id, authorId: row.authorId, episodeId: row.episodeId, blockIndex: row.blockIndex, updatedAt: row.updatedAt }
}
