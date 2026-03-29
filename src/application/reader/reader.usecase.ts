import { Injectable, Inject } from '@nestjs/common'
import { ReaderRepositoryPort } from '@domain/port/outbound/reader-repository.port'
import { Bookmark, ReadingProgress, LibraryItem, SubscribedWork } from '@domain/model/reader'

@Injectable()
export class ReaderUseCase {
  constructor(
    @Inject('ReaderRepositoryPort') private readonly readerRepo: ReaderRepositoryPort,
  ) {}

  /** 북마크 토글 — 있으면 제거, 없으면 추가 */
  async toggleBookmark(authorId: string, episodeId: string): Promise<{ bookmarked: boolean }> {
    const exists = await this.readerRepo.isBookmarked(authorId, episodeId)
    if (exists) {
      await this.readerRepo.removeBookmark(authorId, episodeId)
      return { bookmarked: false }
    }
    await this.readerRepo.addBookmark(authorId, episodeId)
    return { bookmarked: true }
  }

  /** 북마크 목록 조회 */
  async getBookmarks(authorId: string): Promise<Bookmark[]> {
    return this.readerRepo.getBookmarks(authorId)
  }

  /** 읽기 진행도 저장 (upsert) */
  async saveProgress(authorId: string, episodeId: string, blockIndex: number): Promise<ReadingProgress> {
    return this.readerRepo.saveProgress(authorId, episodeId, blockIndex)
  }

  /** 읽기 진행도 조회 */
  async getProgress(authorId: string, episodeId: string): Promise<ReadingProgress | null> {
    return this.readerRepo.getProgress(authorId, episodeId)
  }

  /** 서재 조회 — 북마크된 작품 + 읽기 진행도 + 구독 상태 */
  async getLibrary(userId: string): Promise<{ bookmarked: LibraryItem[]; subscribed: SubscribedWork[] }> {
    const [bookmarked, subscribed] = await Promise.all([
      this.readerRepo.getLibrary(userId),
      this.readerRepo.getSubscribedWorks(userId),
    ])
    return { bookmarked, subscribed }
  }
}
