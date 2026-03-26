import { DiscoveryUseCase } from './discovery.usecase'

describe('DiscoveryUseCase', () => {
  let useCase: DiscoveryUseCase
  let mockAuthorRepo: { search: jest.Mock }
  let mockWorkRepo: { searchByTitle: jest.Mock; findPopular: jest.Mock; findRecent: jest.Mock }

  const mockAuthor = { id: 'author-1', slug: 'test-author', name: '테스트작가', email: 'test@test.com', credits: 3, createdAt: new Date() }
  const mockWork = { id: 'work-1', authorId: 'author-1', slug: 'test-work', title: '테스트작품', subtitle: null, description: null, createdAt: new Date() }

  beforeEach(() => {
    mockAuthorRepo = {
      search: jest.fn().mockResolvedValue([mockAuthor]),
    }
    mockWorkRepo = {
      searchByTitle: jest.fn().mockResolvedValue([mockWork]),
      findPopular: jest.fn().mockResolvedValue([mockWork]),
      findRecent: jest.fn().mockResolvedValue([mockWork]),
    }

    useCase = new DiscoveryUseCase(mockAuthorRepo as any, mockWorkRepo as any)
  })

  describe('searchAuthors', () => {
    it('쿼리로 작가를 검색한다', async () => {
      const result = await useCase.searchAuthors('테스트')

      expect(mockAuthorRepo.search).toHaveBeenCalledWith('테스트', 10)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('테스트작가')
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
})
