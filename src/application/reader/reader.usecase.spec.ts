import { ReaderUseCase } from './reader.usecase'

describe('ReaderUseCase', () => {
  let useCase: ReaderUseCase
  let mockReaderRepo: {
    getBookmarks: jest.Mock
    addBookmark: jest.Mock
    removeBookmark: jest.Mock
    isBookmarked: jest.Mock
    getProgress: jest.Mock
    saveProgress: jest.Mock
  }

  const mockBookmark = { id: 'bm-1', authorId: 'author-1', episodeId: 'ep-1', createdAt: new Date() }
  const mockProgress = { id: 'prog-1', authorId: 'author-1', episodeId: 'ep-1', blockIndex: 5, updatedAt: new Date() }

  beforeEach(() => {
    mockReaderRepo = {
      getBookmarks: jest.fn().mockResolvedValue([mockBookmark]),
      addBookmark: jest.fn().mockResolvedValue(mockBookmark),
      removeBookmark: jest.fn().mockResolvedValue(undefined),
      isBookmarked: jest.fn().mockResolvedValue(false),
      getProgress: jest.fn().mockResolvedValue(mockProgress),
      saveProgress: jest.fn().mockResolvedValue(mockProgress),
    }

    useCase = new ReaderUseCase(mockReaderRepo as any)
  })

  describe('toggleBookmark', () => {
    it('북마크가 없으면 추가하고 bookmarked: true를 반환한다', async () => {
      mockReaderRepo.isBookmarked.mockResolvedValue(false)

      const result = await useCase.toggleBookmark('author-1', 'ep-1')

      expect(mockReaderRepo.addBookmark).toHaveBeenCalledWith('author-1', 'ep-1')
      expect(result.bookmarked).toBe(true)
    })

    it('북마크가 있으면 제거하고 bookmarked: false를 반환한다', async () => {
      mockReaderRepo.isBookmarked.mockResolvedValue(true)

      const result = await useCase.toggleBookmark('author-1', 'ep-1')

      expect(mockReaderRepo.removeBookmark).toHaveBeenCalledWith('author-1', 'ep-1')
      expect(result.bookmarked).toBe(false)
    })

    it('북마크 추가 시 removeBookmark를 호출하지 않는다', async () => {
      mockReaderRepo.isBookmarked.mockResolvedValue(false)

      await useCase.toggleBookmark('author-1', 'ep-1')

      expect(mockReaderRepo.removeBookmark).not.toHaveBeenCalled()
    })

    it('북마크 제거 시 addBookmark를 호출하지 않는다', async () => {
      mockReaderRepo.isBookmarked.mockResolvedValue(true)

      await useCase.toggleBookmark('author-1', 'ep-1')

      expect(mockReaderRepo.addBookmark).not.toHaveBeenCalled()
    })
  })

  describe('getBookmarks', () => {
    it('작가의 북마크 목록을 반환한다', async () => {
      const result = await useCase.getBookmarks('author-1')

      expect(mockReaderRepo.getBookmarks).toHaveBeenCalledWith('author-1')
      expect(result).toHaveLength(1)
      expect(result[0].episodeId).toBe('ep-1')
    })
  })

  describe('saveProgress', () => {
    it('읽기 진행도를 저장하고 반환한다', async () => {
      const result = await useCase.saveProgress('author-1', 'ep-1', 10)

      expect(mockReaderRepo.saveProgress).toHaveBeenCalledWith('author-1', 'ep-1', 10)
      expect(result.blockIndex).toBe(5) // mock 반환값
    })
  })

  describe('getProgress', () => {
    it('읽기 진행도를 조회한다', async () => {
      const result = await useCase.getProgress('author-1', 'ep-1')

      expect(mockReaderRepo.getProgress).toHaveBeenCalledWith('author-1', 'ep-1')
      expect(result).not.toBeNull()
      expect(result!.blockIndex).toBe(5)
    })

    it('진행도가 없으면 null을 반환한다', async () => {
      mockReaderRepo.getProgress.mockResolvedValue(null)

      const result = await useCase.getProgress('author-1', 'ep-999')

      expect(result).toBeNull()
    })
  })
})
