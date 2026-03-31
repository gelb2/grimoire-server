import { ContentUseCase } from './content.usecase'
import { NotFoundException, ForbiddenException } from '@nestjs/common'

describe('ContentUseCase', () => {
  let useCase: ContentUseCase
  let mockWorkRepo: {
    findByAuthorAndWorkSlug: jest.Mock
    findEpisodes: jest.Mock
    findEpisodesFiltered: jest.Mock
    findEpisode: jest.Mock
  }
  let mockStatsRepo: { incrementDailyView: jest.Mock }

  const mockWork = { id: 'work-1', slug: 'my-novel', title: '테스트 소설', authorId: 'author-1' }
  const mockEpisodes = [
    { id: 'ep-1', slug: 'chapter-1', title: '1화', orderNum: 1, status: 'public' },
    { id: 'ep-2', slug: 'chapter-2', title: '2화', orderNum: 2, status: 'upload' },
  ]
  const mockFilteredEpisodes = [
    { id: 'ep-1', slug: 'chapter-1', title: '1화', orderNum: 1, status: 'public' },
  ]
  const mockEpisode = {
    id: 'ep-1', slug: 'chapter-1', title: '1화', workId: 'work-1',
    blocks: [{ type: 'paragraph', content: '본문입니다' }],
    status: 'public', sharedToken: null, sharedExpireAt: null,
  }

  beforeEach(() => {
    mockWorkRepo = {
      findByAuthorAndWorkSlug: jest.fn().mockResolvedValue(mockWork),
      findEpisodes: jest.fn().mockResolvedValue(mockEpisodes),
      findEpisodesFiltered: jest.fn().mockResolvedValue(mockFilteredEpisodes),
      findEpisode: jest.fn().mockResolvedValue(mockEpisode),
    }
    mockStatsRepo = {
      incrementDailyView: jest.fn().mockResolvedValue(undefined),
    }

    useCase = new ContentUseCase(mockWorkRepo as any, mockStatsRepo as any)
  })

  describe('getWorkDetail', () => {
    it('비로그인 — upload 에피소드 제외하고 반환', async () => {
      const result = await useCase.getWorkDetail('test-author', 'my-novel')

      expect(mockWorkRepo.findEpisodesFiltered).toHaveBeenCalledWith('work-1', ['upload'])
      expect(result.episodes).toHaveLength(1)
      expect(result.episodes[0].status).toBe('public')
    })

    it('작가 본인 — 모든 에피소드(upload 포함) 반환', async () => {
      const result = await useCase.getWorkDetail('test-author', 'my-novel', 'author-1')

      expect(mockWorkRepo.findEpisodes).toHaveBeenCalledWith('work-1')
      expect(result.episodes).toHaveLength(2)
    })

    it('작품이 없으면 NotFoundException을 던진다', async () => {
      mockWorkRepo.findByAuthorAndWorkSlug.mockResolvedValue(null)

      await expect(useCase.getWorkDetail('no-author', 'no-work')).rejects.toThrow(NotFoundException)
    })
  })

  describe('getEpisode', () => {
    it('public 에피소드 — 누구나 조회 가능', async () => {
      const result = await useCase.getEpisode('test-author', 'my-novel', 'chapter-1')

      expect(result).toEqual(mockEpisode)
      expect(mockStatsRepo.incrementDailyView).toHaveBeenCalledWith('work-1', expect.any(Date))
    })

    it('upload 에피소드 — 비로그인 시 ForbiddenException', async () => {
      mockWorkRepo.findEpisode.mockResolvedValue({ ...mockEpisode, status: 'upload' })

      await expect(useCase.getEpisode('test-author', 'my-novel', 'chapter-1')).rejects.toThrow(ForbiddenException)
    })

    it('upload 에피소드 — 작가 본인은 조회 가능', async () => {
      mockWorkRepo.findEpisode.mockResolvedValue({ ...mockEpisode, status: 'upload' })

      const result = await useCase.getEpisode('test-author', 'my-novel', 'chapter-1', 'author-1')
      expect(result.status).toBe('upload')
    })

    it('nonPublic 에피소드 — 비로그인 시 ForbiddenException', async () => {
      mockWorkRepo.findEpisode.mockResolvedValue({ ...mockEpisode, status: 'nonPublic' })

      await expect(useCase.getEpisode('test-author', 'my-novel', 'chapter-1')).rejects.toThrow(ForbiddenException)
    })

    it('nonPublic 에피소드 — 로그인 사용자 조회 가능', async () => {
      mockWorkRepo.findEpisode.mockResolvedValue({ ...mockEpisode, status: 'nonPublic' })

      const result = await useCase.getEpisode('test-author', 'my-novel', 'chapter-1', 'other-user')
      expect(result.status).toBe('nonPublic')
    })

    it('에피소드가 없으면 NotFoundException을 던진다', async () => {
      mockWorkRepo.findEpisode.mockResolvedValue(null)

      await expect(useCase.getEpisode('test-author', 'my-novel', 'no-ep')).rejects.toThrow(NotFoundException)
    })

    it('조회수 기록이 실패해도 에피소드는 정상 반환한다', async () => {
      mockStatsRepo.incrementDailyView.mockRejectedValue(new Error('DB 에러'))

      const result = await useCase.getEpisode('test-author', 'my-novel', 'chapter-1')
      expect(result).toEqual(mockEpisode)
    })
  })
})
