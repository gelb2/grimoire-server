import { WorkManagementUseCase } from './work-management.usecase'
import { NotFoundException, ForbiddenException } from '@nestjs/common'

describe('WorkManagementUseCase', () => {
  let useCase: WorkManagementUseCase
  let mockWorkRepo: any

  const mockWork = {
    id: 'work-1',
    authorId: 'author-1',
    slug: 'test-work',
    title: '테스트 작품',
    subtitle: null,
    description: null,
    coverImage: null,
    viewCount: 0,
    createdAt: new Date(),
  }

  const mockEpisode = {
    id: 'ep-1',
    workId: 'work-1',
    slug: 'episode-1',
    title: '에피소드 1',
    subtitle: null,
    type: 'episode',
    orderNum: 1,
    blocks: [],
    rawMd: '본문',
    createdAt: new Date(),
  }

  beforeEach(() => {
    mockWorkRepo = {
      findById: jest.fn(),
      findByAuthorSlug: jest.fn(),
      findByAuthorAndWorkSlug: jest.fn(),
      findEpisodes: jest.fn(),
      findEpisode: jest.fn(),
      findEpisodeById: jest.fn(),
      createWork: jest.fn(),
      updateWork: jest.fn(),
      deleteWork: jest.fn(),
      createEpisode: jest.fn(),
      deleteEpisode: jest.fn(),
      countByAuthorId: jest.fn(),
      countEpisodesByWorkId: jest.fn(),
    }
    const mockBlobStorage = { isEnabled: false, uploadImage: jest.fn(), deleteImage: jest.fn() } as any
    useCase = new WorkManagementUseCase(mockWorkRepo, mockBlobStorage)
  })

  describe('createWork', () => {
    it('작품을 생성하고 반환한다', async () => {
      mockWorkRepo.createWork.mockResolvedValue(mockWork)

      const result = await useCase.createWork('author-1', {
        slug: 'test-work',
        title: '테스트 작품',
      })

      expect(result).toEqual(mockWork)
      expect(mockWorkRepo.createWork).toHaveBeenCalledWith({
        authorId: 'author-1',
        slug: 'test-work',
        title: '테스트 작품',
      })
    })
  })

  describe('updateWork', () => {
    it('소유자가 작품을 수정한다', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.updateWork.mockResolvedValue({ ...mockWork, title: '수정된 제목' })

      const result = await useCase.updateWork('author-1', 'work-1', { title: '수정된 제목' })

      expect(result.title).toBe('수정된 제목')
      expect(mockWorkRepo.updateWork).toHaveBeenCalledWith('work-1', { title: '수정된 제목' })
    })

    it('작품이 없으면 NotFoundException을 던진다', async () => {
      mockWorkRepo.findById.mockResolvedValue(null)

      await expect(
        useCase.updateWork('author-1', 'no-work', { title: '수정' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('소유자가 아니면 ForbiddenException을 던진다', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)

      await expect(
        useCase.updateWork('other-author', 'work-1', { title: '수정' }),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('deleteWork', () => {
    it('소유자가 작품을 삭제한다', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.deleteWork.mockResolvedValue(undefined)

      await useCase.deleteWork('author-1', 'work-1')

      expect(mockWorkRepo.deleteWork).toHaveBeenCalledWith('work-1')
    })

    it('작품이 없으면 NotFoundException을 던진다', async () => {
      mockWorkRepo.findById.mockResolvedValue(null)

      await expect(
        useCase.deleteWork('author-1', 'no-work'),
      ).rejects.toThrow(NotFoundException)
    })

    it('소유자가 아니면 ForbiddenException을 던진다', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)

      await expect(
        useCase.deleteWork('other-author', 'work-1'),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('createEpisode', () => {
    it('에피소드를 생성한다', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.countEpisodesByWorkId.mockResolvedValue(0)
      mockWorkRepo.createEpisode.mockResolvedValue(mockEpisode)

      const result = await useCase.createEpisode('author-1', 'work-1', {
        title: '에피소드 1',
        rawContent: '본문 내용입니다.',
      })

      expect(result).toEqual(mockEpisode)
      expect(mockWorkRepo.createEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          workId: 'work-1',
          title: '에피소드 1',
          orderNum: 1,
        }),
      )
    })

    it('frontmatter가 있는 rawContent에서 메타데이터를 제거하고 블록을 생성한다', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.countEpisodesByWorkId.mockResolvedValue(0)
      mockWorkRepo.createEpisode.mockResolvedValue(mockEpisode)

      const rawContent = `---
slug: ep1
type: episode
title: "테스트"
---
# 에피소드 제목

본문 내용입니다.`

      await useCase.createEpisode('author-1', 'work-1', {
        title: 'Episode 1',
        rawContent,
      })

      const calledWith = mockWorkRepo.createEpisode.mock.calls[0][0]
      // frontmatter 메타데이터가 블록에 포함되지 않아야 한다
      const paragraphTexts = calledWith.blocks
        .filter((b: any) => b.type === 'paragraph')
        .map((b: any) => b.text)
      expect(paragraphTexts).not.toContain('slug: ep1')
      expect(paragraphTexts).not.toContain('type: episode')
      expect(paragraphTexts).toContain('본문 내용입니다.')
    })

    it('한글 제목의 슬러그에서 한글을 제거한다', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.countEpisodesByWorkId.mockResolvedValue(0)
      mockWorkRepo.createEpisode.mockResolvedValue(mockEpisode)

      await useCase.createEpisode('author-1', 'work-1', {
        title: '서시',
        rawContent: '본문',
      })

      const calledWith = mockWorkRepo.createEpisode.mock.calls[0][0]
      // 한글만 있는 제목은 빈 문자열 → fallback slug 사용
      expect(calledWith.slug).toBe('episode-1')
    })

    it('소유자가 아니면 ForbiddenException을 던진다', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)

      await expect(
        useCase.createEpisode('other-author', 'work-1', {
          title: '에피소드',
          rawContent: '본문',
        }),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('deleteEpisode', () => {
    it('소유자가 에피소드를 삭제한다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.deleteEpisode.mockResolvedValue(undefined)

      await useCase.deleteEpisode('author-1', 'ep-1')

      expect(mockWorkRepo.deleteEpisode).toHaveBeenCalledWith('ep-1')
    })

    it('에피소드가 없으면 NotFoundException을 던진다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(null)

      await expect(
        useCase.deleteEpisode('author-1', 'no-ep'),
      ).rejects.toThrow(NotFoundException)
    })

    it('소유자가 아니면 ForbiddenException을 던진다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue({ ...mockWork, authorId: 'other-author' })

      await expect(
        useCase.deleteEpisode('author-1', 'ep-1'),
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
