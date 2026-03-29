import { StatsUseCase } from './stats.usecase'
import { ForbiddenException, NotFoundException } from '@nestjs/common'

describe('StatsUseCase', () => {
  let useCase: StatsUseCase
  let mockStatsRepo: {
    incrementDailyView: jest.Mock
    getDailyViews: jest.Mock
  }
  let mockWorkRepo: {
    findById: jest.Mock
  }

  const mockWork = { id: 'work-1', authorId: 'author-1', slug: 'test', title: '테스트', subtitle: null, description: null, viewCount: 100, createdAt: new Date() }

  beforeEach(() => {
    mockStatsRepo = {
      incrementDailyView: jest.fn().mockResolvedValue(undefined),
      getDailyViews: jest.fn().mockResolvedValue([
        { date: '2026-03-25', count: 50 },
        { date: '2026-03-26', count: 75 },
        { date: '2026-03-27', count: 30 },
      ]),
    }
    mockWorkRepo = {
      findById: jest.fn().mockResolvedValue(mockWork),
    }

    useCase = new StatsUseCase(mockStatsRepo as any, mockWorkRepo as any)
  })

  describe('recordView', () => {
    it('일별 조회수를 증가시킨다', async () => {
      await useCase.recordView('work-1')

      expect(mockStatsRepo.incrementDailyView).toHaveBeenCalledWith('work-1', expect.any(Date))
    })
  })

  describe('getWorkStats', () => {
    it('소유자가 작품 통계를 조회할 수 있다', async () => {
      const result = await useCase.getWorkStats('author-1', 'work-1')

      expect(result.dates).toHaveLength(3)
      expect(result.counts).toEqual([50, 75, 30])
      expect(result.totalViews).toBe(155)
    })

    it('존재하지 않는 작품은 NotFoundException을 던진다', async () => {
      mockWorkRepo.findById.mockResolvedValue(null)

      await expect(useCase.getWorkStats('author-1', 'not-exist')).rejects.toThrow(NotFoundException)
    })

    it('소유자가 아니면 ForbiddenException을 던진다', async () => {
      await expect(useCase.getWorkStats('other-author', 'work-1')).rejects.toThrow(ForbiddenException)
    })
  })
})
