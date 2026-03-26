import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { ReaderRepositoryPort } from '@domain/port/outbound/reader-repository.port'
import { Bookmark, ReadingProgress } from '@domain/model/reader'

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
}

function toBookmarkDomain(row: { id: string; authorId: string; episodeId: string; createdAt: Date }): Bookmark {
  return { id: row.id, authorId: row.authorId, episodeId: row.episodeId, createdAt: row.createdAt }
}

function toProgressDomain(row: { id: string; authorId: string; episodeId: string; blockIndex: number; updatedAt: Date }): ReadingProgress {
  return { id: row.id, authorId: row.authorId, episodeId: row.episodeId, blockIndex: row.blockIndex, updatedAt: row.updatedAt }
}
