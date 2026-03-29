import { ContentUseCase } from './content.usecase'
import { NotFoundException } from '@nestjs/common'

describe('ContentUseCase', () => {
  let useCase: ContentUseCase
  let mockWorkRepo: {
    findByAuthorAndWorkSlug: jest.Mock
    findEpisodes: jest.Mock
    findEpisode: jest.Mock
  }
  let mockStatsRepo: { incrementDailyView: jest.Mock }

  const mockWork = { id: 'work-1', slug: 'my-novel', title: '테스트 소설', authorId: 'author-1' }
  const mockEpisodes = [
    { id: 'ep-1', slug: 'chapter-1', title: '1화', order: 1 },
    { id: 'ep-2', slug: 'chapter-2', title: '2화', order: 2 },
  ]
  const mockEpisode = {
    id: 'ep-1', slug: 'chapter-1', title: '1화', workId: 'work-1',
    blocks: [{ type: 'paragraph', content: '본문입니다' }],
  }

  beforeEach(() => {
    mockWorkRepo = {
      findByAuthorAndWorkSlug: jest.fn().mockResolvedValue(mockWork),
      findEpisodes: jest.fn().mockResolvedValue(mockEpisodes),
      findEpisode: jest.fn().mockResolvedValue(mockEpisode),
    }
    mockStatsRepo = {
      incrementDailyView: jest.fn().mockResolvedValue(undefined),
    }

    useCase = new ContentUseCase(mockWorkRepo as any, mockStatsRepo as any)
  })

  describe('getWorkDetail', () => {
    it('작품 상세와 에피소드 목록을 반환한다', async () => {
      const result = await useCase.getWorkDetail('test-author', 'my-novel')

      expect(mockWorkRepo.findByAuthorAndWorkSlug).toHaveBeenCalledWith('test-author', 'my-novel')
      expect(mockWorkRepo.findEpisodes).toHaveBeenCalledWith('work-1')
      expect(result.work).toEqual(mockWork)
      expect(result.episodes).toHaveLength(2)
    })

    it('작품이 없으면 NotFoundException을 던진다', async () => {
      mockWorkRepo.findByAuthorAndWorkSlug.mockResolvedValue(null)

      await expect(useCase.getWorkDetail('no-author', 'no-work')).rejects.toThrow(NotFoundException)
      await expect(useCase.getWorkDetail('no-author', 'no-work')).rejects.toThrow('작품을 찾을 수 없습니다')
    })
  })

  describe('getEpisode', () => {
    it('에피소드를 반환하고 조회수를 기록한다', async () => {
      const result = await useCase.getEpisode('test-author', 'my-novel', 'chapter-1')

      expect(mockWorkRepo.findEpisode).toHaveBeenCalledWith('test-author', 'my-novel', 'chapter-1')
      expect(result).toEqual(mockEpisode)
      // 비동기 조회수 기록 호출 확인
      expect(mockStatsRepo.incrementDailyView).toHaveBeenCalledWith('work-1', expect.any(Date))
    })

    it('에피소드가 없으면 NotFoundException을 던진다', async () => {
      mockWorkRepo.findEpisode.mockResolvedValue(null)

      await expect(useCase.getEpisode('test-author', 'my-novel', 'no-ep')).rejects.toThrow(NotFoundException)
      await expect(useCase.getEpisode('test-author', 'my-novel', 'no-ep')).rejects.toThrow('에피소드를 찾을 수 없습니다')
    })

    it('조회수 기록이 실패해도 에피소드는 정상 반환한다', async () => {
      mockStatsRepo.incrementDailyView.mockRejectedValue(new Error('DB 에러'))

      const result = await useCase.getEpisode('test-author', 'my-novel', 'chapter-1')

      // 조회수 실패와 무관하게 에피소드 정상 반환
      expect(result).toEqual(mockEpisode)
    })
  })
})
