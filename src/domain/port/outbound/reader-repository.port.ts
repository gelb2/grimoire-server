import { Bookmark, ReadingProgress, LibraryItem, SubscribedWork } from '@domain/model/reader'

export interface ReaderRepositoryPort {
  /** 작가의 북마크 목록 조회 */
  getBookmarks(authorId: string): Promise<Bookmark[]>
  /** 북마크 추가 */
  addBookmark(authorId: string, episodeId: string): Promise<Bookmark>
  /** 북마크 제거 */
  removeBookmark(authorId: string, episodeId: string): Promise<void>
  /** 북마크 여부 확인 */
  isBookmarked(authorId: string, episodeId: string): Promise<boolean>
  /** 읽기 진행도 조회 */
  getProgress(authorId: string, episodeId: string): Promise<ReadingProgress | null>
  /** 읽기 진행도 저장 (upsert) */
  saveProgress(authorId: string, episodeId: string, blockIndex: number): Promise<ReadingProgress>
  /** 서재 조회 — 북마크된 작품 + 읽기 진행도 + 구독 상태 */
  getLibrary(userId: string): Promise<LibraryItem[]>
  /** 구독 작가의 최신 작품 조회 */
  getSubscribedWorks(userId: string): Promise<SubscribedWork[]>
}
