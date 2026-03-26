import { Bookmark, ReadingProgress } from '@domain/model/reader'

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
}
