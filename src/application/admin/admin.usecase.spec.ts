import { AdminUseCase } from './admin.usecase'

describe('AdminUseCase', () => {
  let useCase: AdminUseCase
  let mockPrisma: {
    author: { count: jest.Mock }
    work: { count: jest.Mock }
    episode: { count: jest.Mock }
    creditLog: { aggregate: jest.Mock }
  }
  let mockCreditUseCase: { grant: jest.Mock }

  beforeEach(() => {
    mockPrisma = {
      author: { count: jest.fn().mockResolvedValue(10) },
      work: { count: jest.fn().mockResolvedValue(25) },
      episode: { count: jest.fn().mockResolvedValue(120) },
      creditLog: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: -50 } }),
      },
    }
    mockCreditUseCase = {
      grant: jest.fn().mockResolvedValue({ credits: 13, log: { id: 'log-1', authorId: 'author-1', amount: 10, reason: 'admin_grant', createdAt: new Date() } }),
    }

    useCase = new AdminUseCase(mockPrisma as any, mockCreditUseCase as any)
  })

  describe('getStats', () => {
    it('플랫폼 통계를 올바르게 반환한다', async () => {
      const result = await useCase.getStats()

      expect(result.totalAuthors).toBe(10)
      expect(result.totalWorks).toBe(25)
      expect(result.totalEpisodes).toBe(120)
      expect(result.totalCreditsConsumed).toBe(50)
    })

    it('크레딧 소비가 없으면 0을 반환한다', async () => {
      mockPrisma.creditLog.aggregate.mockResolvedValue({ _sum: { amount: null } })

      const result = await useCase.getStats()

      expect(result.totalCreditsConsumed).toBe(0)
    })

    it('Promise.all로 4개 쿼리를 동시에 호출한다', async () => {
      await useCase.getStats()

      expect(mockPrisma.author.count).toHaveBeenCalledTimes(1)
      expect(mockPrisma.work.count).toHaveBeenCalledTimes(1)
      expect(mockPrisma.episode.count).toHaveBeenCalledTimes(1)
      expect(mockPrisma.creditLog.aggregate).toHaveBeenCalledWith({
        _sum: { amount: true },
        where: { amount: { lt: 0 } },
      })
    })
  })

  describe('grantCredits', () => {
    it('creditUseCase.grant에 위임하여 크레딧을 부여한다', async () => {
      const result = await useCase.grantCredits('author-1', 10, 'admin_grant')

      expect(mockCreditUseCase.grant).toHaveBeenCalledWith('author-1', 10, 'admin_grant')
      expect(result.credits).toBe(13)
      expect(result.log.amount).toBe(10)
    })

    it('creditUseCase.grant가 에러를 던지면 그대로 전파한다', async () => {
      mockCreditUseCase.grant.mockRejectedValue(new Error('적립 금액은 양수여야 합니다'))

      await expect(useCase.grantCredits('author-1', 0, 'test')).rejects.toThrow('적립 금액은 양수여야 합니다')
    })
  })
})
