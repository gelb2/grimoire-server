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
    getLibrary: jest.Mock
    getSubscribedWorks: jest.Mock
  }

  const mockBookmark = { id: 'bm-1', authorId: 'author-1', episodeId: 'ep-1', createdAt: new Date() }
  const mockProgress = { id: 'prog-1', authorId: 'author-1', episodeId: 'ep-1', blockIndex: 5, updatedAt: new Date() }
  const mockLibraryItem = {
    workId: 'work-1',
    workTitle: '테스트 작품',
    workSlug: 'test-work',
    authorName: '작가1',
    authorSlug: 'author-1',
    episodeCount: 10,
    readEpisodeCount: 3,
    lastReadEpisodeTitle: '3화',
    lastReadEpisodeSlug: 'episode-3',
    subscribed: true,
  }
  const mockSubscribedWork = {
    workId: 'work-2',
    workTitle: '구독 작품',
    workSlug: 'subscribed-work',
    authorName: '작가2',
    authorSlug: 'author-2',
    episodeCount: 5,
    latestEpisodeTitle: '5화',
    createdAt: new Date(),
  }

  beforeEach(() => {
    mockReaderRepo = {
      getBookmarks: jest.fn().mockResolvedValue([mockBookmark]),
      addBookmark: jest.fn().mockResolvedValue(mockBookmark),
      removeBookmark: jest.fn().mockResolvedValue(undefined),
      isBookmarked: jest.fn().mockResolvedValue(false),
      getProgress: jest.fn().mockResolvedValue(mockProgress),
      saveProgress: jest.fn().mockResolvedValue(mockProgress),
      getLibrary: jest.fn().mockResolvedValue([mockLibraryItem]),
      getSubscribedWorks: jest.fn().mockResolvedValue([mockSubscribedWork]),
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

  describe('getLibrary', () => {
    it('북마크된 작품과 구독 작품을 함께 반환한다', async () => {
      const result = await useCase.getLibrary('author-1')

      expect(mockReaderRepo.getLibrary).toHaveBeenCalledWith('author-1')
      expect(mockReaderRepo.getSubscribedWorks).toHaveBeenCalledWith('author-1')
      expect(result.bookmarked).toHaveLength(1)
      expect(result.bookmarked[0].workTitle).toBe('테스트 작품')
      expect(result.subscribed).toHaveLength(1)
      expect(result.subscribed[0].workTitle).toBe('구독 작품')
    })

    it('북마크/구독이 없으면 빈 배열을 반환한다', async () => {
      mockReaderRepo.getLibrary.mockResolvedValue([])
      mockReaderRepo.getSubscribedWorks.mockResolvedValue([])

      const result = await useCase.getLibrary('author-1')

      expect(result.bookmarked).toHaveLength(0)
      expect(result.subscribed).toHaveLength(0)
    })
  })
})
