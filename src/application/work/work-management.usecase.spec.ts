import { WorkManagementUseCase } from './work-management.usecase'
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'

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
    themeId: null,
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
    status: 'upload',
    sharedToken: null,
    sharedExpireAt: null,
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
      updateEpisodeStatus: jest.fn(),
      findBySharedToken: jest.fn(),
      findEpisodesFiltered: jest.fn(),
    }
    const mockBlobStorage = { isEnabled: false, uploadImage: jest.fn(), deleteImage: jest.fn() } as any
    const mockNovelAnalysis = { indexEpisode: jest.fn().mockResolvedValue({ chunkCount: 0, tokensUsed: 0 }) } as any
    const mockCreditUseCase = { grant: jest.fn().mockResolvedValue({ credits: 2, log: {} }) } as any
    useCase = new WorkManagementUseCase(mockWorkRepo, mockBlobStorage, mockNovelAnalysis, mockCreditUseCase)
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

    it('title의 언더스코어를 공백으로 정규화한 뒤 저장한다 (Safari 자모 분해 방지)', async () => {
      mockWorkRepo.createWork.mockResolvedValue(mockWork)

      await useCase.createWork('author-1', {
        slug: 'test-work',
        title: '사슴악마_ep9_도리안그레이의초상_초고',
      })

      expect(mockWorkRepo.createWork).toHaveBeenCalledWith(
        expect.objectContaining({ title: '사슴악마 ep9 도리안그레이의초상 초고' }),
      )
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

    it('title이 전달되면 정규화해서 저장한다', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.updateWork.mockResolvedValue(mockWork)

      await useCase.updateWork('author-1', 'work-1', {
        title: 'foo_bar__baz',
        description: '설명',
      })

      expect(mockWorkRepo.updateWork).toHaveBeenCalledWith('work-1', {
        title: 'foo bar baz',
        description: '설명',
      })
    })

    it('title이 없으면 정규화 로직을 건너뛴다', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.updateWork.mockResolvedValue(mockWork)

      await useCase.updateWork('author-1', 'work-1', { description: '설명만' })

      expect(mockWorkRepo.updateWork).toHaveBeenCalledWith('work-1', { description: '설명만' })
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

    it('title의 언더스코어를 공백으로 정규화한 뒤 저장한다 (Safari 자모 분해 방지)', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.countEpisodesByWorkId.mockResolvedValue(0)
      mockWorkRepo.createEpisode.mockResolvedValue(mockEpisode)

      await useCase.createEpisode('author-1', 'work-1', {
        title: '사슴악마_ep9_도리안그레이의초상_초고',
        rawContent: '본문 내용입니다.',
      })

      const calledWith = mockWorkRepo.createEpisode.mock.calls[0][0]
      expect(calledWith.title).toBe('사슴악마 ep9 도리안그레이의초상 초고')
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

  describe('updateEpisodeStatus', () => {
    it('작가가 에피소드 상태를 변경한다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.findEpisodesFiltered.mockResolvedValue([mockEpisode])
      mockWorkRepo.updateEpisodeStatus.mockResolvedValue({ ...mockEpisode, status: 'public' })

      const result = await useCase.updateEpisodeStatus('author-1', 'ep-1', 'public')
      expect(result.status).toBe('public')
      expect(mockWorkRepo.updateEpisodeStatus).toHaveBeenCalledWith('ep-1', 'public', undefined, undefined)
    })

    it('shared 상태로 직접 변경 불가', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)

      await expect(
        useCase.updateEpisodeStatus('author-1', 'ep-1', 'shared'),
      ).rejects.toThrow(BadRequestException)
    })

    it('shared → public 변경 시 토큰 초기화', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue({ ...mockEpisode, status: 'shared', sharedToken: 'abc' })
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.updateEpisodeStatus.mockResolvedValue({ ...mockEpisode, status: 'public', sharedToken: null })

      await useCase.updateEpisodeStatus('author-1', 'ep-1', 'public')
      expect(mockWorkRepo.updateEpisodeStatus).toHaveBeenCalledWith('ep-1', 'public', null, null)
    })

    it('소유자가 아니면 ForbiddenException', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)

      await expect(
        useCase.updateEpisodeStatus('other-author', 'ep-1', 'public'),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('createShareLink', () => {
    it('공유 링크를 생성한다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.updateEpisodeStatus.mockResolvedValue({ ...mockEpisode, status: 'shared' })

      const result = await useCase.createShareLink('author-1', 'ep-1', '24h')

      expect(result.sharedToken).toBeDefined()
      expect(result.sharedToken.length).toBe(48) // 24 bytes hex
      expect(result.expireAt).toBeInstanceOf(Date)
      expect(result.sharedUrl).toContain('/shared/')
    })

    it('만료 없는 공유 링크', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.updateEpisodeStatus.mockResolvedValue({ ...mockEpisode, status: 'shared' })

      const result = await useCase.createShareLink('author-1', 'ep-1', 'never')
      expect(result.expireAt).toBeNull()
    })
  })

  describe('getEpisodeBySharedToken', () => {
    it('유효한 공유 토큰으로 에피소드 반환', async () => {
      const sharedEpisode = { ...mockEpisode, status: 'shared', sharedToken: 'abc', sharedExpireAt: new Date(Date.now() + 86400000) }
      mockWorkRepo.findBySharedToken.mockResolvedValue(sharedEpisode)

      const result = await useCase.getEpisodeBySharedToken('abc')
      expect(result.id).toBe('ep-1')
    })

    it('만료된 공유 토큰 → ForbiddenException', async () => {
      const expired = { ...mockEpisode, status: 'shared', sharedToken: 'abc', sharedExpireAt: new Date(Date.now() - 1000) }
      mockWorkRepo.findBySharedToken.mockResolvedValue(expired)

      await expect(useCase.getEpisodeBySharedToken('abc')).rejects.toThrow(ForbiddenException)
    })

    it('존재하지 않는 토큰 → NotFoundException', async () => {
      mockWorkRepo.findBySharedToken.mockResolvedValue(null)

      await expect(useCase.getEpisodeBySharedToken('no-token')).rejects.toThrow(NotFoundException)
    })
  })

  describe('reuploadEpisode', () => {
    const updatedMock = { ...mockEpisode, title: '정규화된 제목' }

    beforeEach(() => {
      mockWorkRepo.updateEpisodeContent = jest.fn().mockResolvedValue(updatedMock)
    })

    it('title이 전달되면 정규화해서 저장한다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)

      await useCase.reuploadEpisode('author-1', 'ep-1', {
        title: '사슴악마_ep9_도리안그레이의초상_초고',
        rawContent: '본문',
      })

      const calledWith = mockWorkRepo.updateEpisodeContent.mock.calls[0][1]
      expect(calledWith.title).toBe('사슴악마 ep9 도리안그레이의초상 초고')
    })

    it('title이 없으면 기존 episode.title을 유지한다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)

      await useCase.reuploadEpisode('author-1', 'ep-1', {
        rawContent: '본문만 갱신',
      })

      const calledWith = mockWorkRepo.updateEpisodeContent.mock.calls[0][1]
      expect(calledWith.title).toBe(mockEpisode.title)
    })

    it('소유자가 아니면 ForbiddenException을 던진다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)

      await expect(
        useCase.reuploadEpisode('other-author', 'ep-1', { rawContent: '본문' }),
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
