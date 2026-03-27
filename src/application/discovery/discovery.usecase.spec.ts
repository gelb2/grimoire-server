import { DiscoveryUseCase } from './discovery.usecase'

describe('DiscoveryUseCase', () => {
  let useCase: DiscoveryUseCase
  let mockAuthorRepo: { search: jest.Mock }
  let mockWorkRepo: {
    searchByTitle: jest.Mock
    findPopular: jest.Mock
    findRecent: jest.Mock
    findPopularPaginated: jest.Mock
    findRecentPaginated: jest.Mock
  }

  const mockAuthor = { id: 'author-1', slug: 'test-author', name: '테스트작가', email: 'test@test.com', passwordHash: 'hashed', credits: 3, createdAt: new Date() }
  const mockWork = { id: 'work-1', authorId: 'author-1', slug: 'test-work', title: '테스트작품', subtitle: null, description: null, viewCount: 0, createdAt: new Date() }
  const mockWorkWithMeta = { ...mockWork, authorName: '테스트작가', authorSlug: 'test-author', episodeCount: 3 }

  beforeEach(() => {
    mockAuthorRepo = {
      search: jest.fn().mockResolvedValue([mockAuthor]),
    }
    mockWorkRepo = {
      searchByTitle: jest.fn().mockResolvedValue([mockWork]),
      findPopular: jest.fn().mockResolvedValue([mockWork]),
      findRecent: jest.fn().mockResolvedValue([mockWork]),
      findPopularPaginated: jest.fn().mockResolvedValue({ works: [mockWorkWithMeta], totalCount: 15 }),
      findRecentPaginated: jest.fn().mockResolvedValue({ works: [mockWorkWithMeta], totalCount: 15 }),
    }

    useCase = new DiscoveryUseCase(mockAuthorRepo as any, mockWorkRepo as any)
  })

  describe('searchAuthors', () => {
    it('쿼리로 작가를 검색한다 (민감 필드 제거)', async () => {
      const result = await useCase.searchAuthors('테스트')

      expect(mockAuthorRepo.search).toHaveBeenCalledWith('테스트', 10)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('테스트작가')
      // passwordHash, email이 제거되었는지 확인
      expect((result[0] as any).passwordHash).toBeUndefined()
      expect((result[0] as any).email).toBeUndefined()
    })

    it('limit 파라미터를 전달한다', async () => {
      await useCase.searchAuthors('test', 5)

      expect(mockAuthorRepo.search).toHaveBeenCalledWith('test', 5)
    })
  })

  describe('getPopularWorks', () => {
    it('인기 작품 목록을 반환한다', async () => {
      const result = await useCase.getPopularWorks()

      expect(mockWorkRepo.findPopular).toHaveBeenCalledWith(10)
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('테스트작품')
    })
  })

  describe('getRecentWorks', () => {
    it('최신 작품 목록을 반환한다', async () => {
      const result = await useCase.getRecentWorks(5)

      expect(mockWorkRepo.findRecent).toHaveBeenCalledWith(5)
      expect(result).toHaveLength(1)
    })
  })

  describe('getPopularWorksPaginated', () => {
    it('페이지네이션된 인기 작품을 반환한다', async () => {
      const result = await useCase.getPopularWorksPaginated(1, 12)

      expect(mockWorkRepo.findPopularPaginated).toHaveBeenCalledWith(1, 12)
      expect(result.works).toHaveLength(1)
      expect(result.totalCount).toBe(15)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(12)
      expect(result.hasMore).toBe(true)
    })

    it('마지막 페이지에서 hasMore가 false를 반환한다', async () => {
      mockWorkRepo.findPopularPaginated.mockResolvedValue({ works: [mockWorkWithMeta], totalCount: 5 })

      const result = await useCase.getPopularWorksPaginated(1, 12)

      expect(result.hasMore).toBe(false)
    })

    it('기본값으로 page=1, pageSize=12를 사용한다', async () => {
      await useCase.getPopularWorksPaginated()

      expect(mockWorkRepo.findPopularPaginated).toHaveBeenCalledWith(1, 12)
    })
  })

  describe('getRecentWorksPaginated', () => {
    it('페이지네이션된 최신 작품을 반환한다', async () => {
      mockWorkRepo.findRecentPaginated.mockResolvedValue({ works: [mockWorkWithMeta], totalCount: 30 })

      const result = await useCase.getRecentWorksPaginated(2, 8)

      expect(mockWorkRepo.findRecentPaginated).toHaveBeenCalledWith(2, 8)
      expect(result.works).toHaveLength(1)
      expect(result.totalCount).toBe(30)
      expect(result.page).toBe(2)
      expect(result.pageSize).toBe(8)
      expect(result.hasMore).toBe(true)
    })

    it('마지막 페이지에서 hasMore가 false를 반환한다', async () => {
      mockWorkRepo.findRecentPaginated.mockResolvedValue({ works: [mockWorkWithMeta], totalCount: 3 })

      const result = await useCase.getRecentWorksPaginated(1, 12)

      expect(result.hasMore).toBe(false)
    })
  })
})
