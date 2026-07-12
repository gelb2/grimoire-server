import { WorkManagementUseCase } from './work-management.usecase'
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'

describe('WorkManagementUseCase', () => {
  let useCase: WorkManagementUseCase
  let mockWorkRepo: any
  // 크레딧 개편 CC-1 (2026-05-19) — 첫 작품 보너스 신 원장 적립 mock
  let mockGrantPoints: any

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
      reorderEpisodes: jest.fn(),
    }
    const mockBlobStorage = { isEnabled: false, uploadImage: jest.fn(), deleteImage: jest.fn() } as any
    const mockNovelAnalysis = { indexEpisode: jest.fn().mockResolvedValue({ chunkCount: 0, tokensUsed: 0 }) } as any
    // 크레딧 개편 CC-1 (2026-05-19) — 구 mockCreditUseCase.grant → mockGrantPoints.grantFirstWorkBonus
    mockGrantPoints = { grantFirstWorkBonus: jest.fn().mockResolvedValue(undefined) } as any
    useCase = new WorkManagementUseCase(mockWorkRepo, mockBlobStorage, mockNovelAnalysis, mockGrantPoints)
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

    // F-5 (2026-07-11) — 채팅 프로젝트 메모리(context)/지침(instructions) 저장 경로 관통
    it('context/instructions 를 저장 경로로 관통시킨다', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.updateWork.mockResolvedValue(mockWork)

      await useCase.updateWork('author-1', 'work-1', {
        context: '세계관: 근미래 서울',
        instructions: '문체는 건조하게',
      })

      expect(mockWorkRepo.updateWork).toHaveBeenCalledWith('work-1', {
        context: '세계관: 근미래 서울',
        instructions: '문체는 건조하게',
      })
    })

    // F-5 — 명백한 AI 사과문 패턴은 차단하지 않고(저장 허용) AuditLog 로 관찰만 (원문 로깅 0)
    it('context 에 AI 사과문 패턴이 있으면 저장은 허용하되 AuditLog 관찰을 남긴다', async () => {
      const mockAuditLog = { log: jest.fn().mockResolvedValue(undefined) }
      const ucWithAudit = new WorkManagementUseCase(
        mockWorkRepo,
        { isEnabled: false } as any,
        { indexEpisode: jest.fn() } as any,
        mockGrantPoints,
        mockAuditLog as any,
      )
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.updateWork.mockResolvedValue(mockWork)

      await ucWithAudit.updateWork('author-1', 'work-1', {
        context: '죄송합니다. 저는 AI 어시스턴트로서 도울 수 없습니다.',
      })

      // 저장은 그대로 관통 (차단 아님)
      expect(mockWorkRepo.updateWork).toHaveBeenCalled()
      // AuditLog 관찰 — 원문이 아니라 field/length 만 박제
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'author-1',
        'work_context_ai_apology_suspected',
        'work-1',
        { field: 'context', length: expect.any(Number) },
      )
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

  describe('reorderEpisodes (F-20 — 에피소드 순서 변경)', () => {
    const ep1 = { ...mockEpisode, id: 'ep-1', orderNum: 1 }
    const ep2 = { ...mockEpisode, id: 'ep-2', orderNum: 2 }
    const ep3 = { ...mockEpisode, id: 'ep-3', orderNum: 3 }

    it('소유자가 전체 에피소드를 재정렬한다 (reorderEpisodes 위임 + 재정렬 목록 반환)', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      // 1회차 = 집합 검증용(원래 순서), 2회차 = 재부여 후 반환용(새 순서)
      mockWorkRepo.findEpisodesFiltered
        .mockResolvedValueOnce([ep1, ep2, ep3])
        .mockResolvedValueOnce([
          { ...ep3, orderNum: 1 },
          { ...ep1, orderNum: 2 },
          { ...ep2, orderNum: 3 },
        ])
      mockWorkRepo.reorderEpisodes.mockResolvedValue(undefined)

      const result = await useCase.reorderEpisodes('author-1', 'work-1', ['ep-3', 'ep-1', 'ep-2'])

      expect(mockWorkRepo.reorderEpisodes).toHaveBeenCalledWith('work-1', ['ep-3', 'ep-1', 'ep-2'])
      // 반환은 orderNum 오름차순(목록 조회와 동일 정렬)
      expect(result.map((e: any) => e.id)).toEqual(['ep-3', 'ep-1', 'ep-2'])
    })

    it('작품이 없으면 NotFoundException', async () => {
      mockWorkRepo.findById.mockResolvedValue(null)
      await expect(
        useCase.reorderEpisodes('author-1', 'no-work', ['ep-1']),
      ).rejects.toThrow(NotFoundException)
      expect(mockWorkRepo.reorderEpisodes).not.toHaveBeenCalled()
    })

    it('소유자가 아니면 ForbiddenException (재정렬 미실행)', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      await expect(
        useCase.reorderEpisodes('other-author', 'work-1', ['ep-1', 'ep-2', 'ep-3']),
      ).rejects.toThrow(ForbiddenException)
      expect(mockWorkRepo.reorderEpisodes).not.toHaveBeenCalled()
    })

    it('빈 배열이면 BadRequestException', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      await expect(
        useCase.reorderEpisodes('author-1', 'work-1', []),
      ).rejects.toThrow(BadRequestException)
    })

    it('중복 id 가 있으면 BadRequestException', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      await expect(
        useCase.reorderEpisodes('author-1', 'work-1', ['ep-1', 'ep-1', 'ep-2']),
      ).rejects.toThrow(BadRequestException)
      expect(mockWorkRepo.reorderEpisodes).not.toHaveBeenCalled()
    })

    it('작품 전체 에피소드와 개수가 다르면 BadRequestException (불일치 집합)', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.findEpisodesFiltered.mockResolvedValue([ep1, ep2, ep3])
      await expect(
        useCase.reorderEpisodes('author-1', 'work-1', ['ep-1', 'ep-2']),
      ).rejects.toThrow(BadRequestException)
      expect(mockWorkRepo.reorderEpisodes).not.toHaveBeenCalled()
    })

    it('작품에 속하지 않은 id 가 포함되면 BadRequestException (불일치 집합)', async () => {
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.findEpisodesFiltered.mockResolvedValue([ep1, ep2, ep3])
      await expect(
        useCase.reorderEpisodes('author-1', 'work-1', ['ep-1', 'ep-2', 'ep-X']),
      ).rejects.toThrow(BadRequestException)
      expect(mockWorkRepo.reorderEpisodes).not.toHaveBeenCalled()
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
    it('작가가 에피소드 상태를 변경한다 (첫 public 전환 — 첫 작품 보너스 적립)', async () => {
      // mockEpisode.status='upload', findEpisodesFiltered=[upload만] → hasPublished=false → 보너스 적립
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.findEpisodesFiltered.mockResolvedValue([mockEpisode])
      mockWorkRepo.updateEpisodeStatus.mockResolvedValue({ ...mockEpisode, status: 'public' })

      const result = await useCase.updateEpisodeStatus('author-1', 'ep-1', 'public')
      expect(result.status).toBe('public')
      expect(mockWorkRepo.updateEpisodeStatus).toHaveBeenCalledWith('ep-1', 'public', undefined, undefined)
      // 크레딧 개편 CC-1 — 첫 작품 최초 public 전환 시 신 포인트 원장 적립
      expect(mockGrantPoints.grantFirstWorkBonus).toHaveBeenCalledWith('author-1')
      expect(mockGrantPoints.grantFirstWorkBonus).toHaveBeenCalledTimes(1)
    })

    // 크레딧 개편 CC-1 (2026-05-19) — 첫 작품 보너스 멱등 가드 검증
    it('이미 public 에피소드가 있으면 재전환 시 첫 작품 보너스 미적립 (멱등)', async () => {
      // upload 에피소드를 public 전환하나, 같은 작품에 이미 public 에피소드 존재
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.findEpisodesFiltered.mockResolvedValue([
        mockEpisode,
        { ...mockEpisode, id: 'ep-2', status: 'public' },
      ])
      mockWorkRepo.updateEpisodeStatus.mockResolvedValue({ ...mockEpisode, status: 'public' })

      await useCase.updateEpisodeStatus('author-1', 'ep-1', 'public')
      // hasPublished=true → 보너스 미적립
      expect(mockGrantPoints.grantFirstWorkBonus).not.toHaveBeenCalled()
    })

    it('public → upload 등 비-최초전환 시 첫 작품 보너스 미적립', async () => {
      // episode.status='public' → upload 로 변경: upload→public 조건 불충족
      mockWorkRepo.findEpisodeById.mockResolvedValue({ ...mockEpisode, status: 'public' })
      mockWorkRepo.findById.mockResolvedValue(mockWork)
      mockWorkRepo.updateEpisodeStatus.mockResolvedValue({ ...mockEpisode, status: 'upload' })

      await useCase.updateEpisodeStatus('author-1', 'ep-1', 'upload')
      expect(mockGrantPoints.grantFirstWorkBonus).not.toHaveBeenCalled()
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

  describe('getEpisodeRawForOwner (묶음 MM 신설 — 인라인 본문 편집용)', () => {
    it('소유자에게 rawMd 포함 응답을 반환한다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue({
        ...mockEpisode,
        rawMd: '## 5화\n\n학계 용어로 ContextRot, 어텐션 상실',
        sourceFormat: 'markdown',
        orderNum: 5,
      } as any)
      mockWorkRepo.findById.mockResolvedValue(mockWork)

      const result = await useCase.getEpisodeRawForOwner('author-1', 'ep-1')

      expect(result.id).toBe('ep-1')
      expect(result.rawMd).toContain('학계 용어로 ContextRot')
      expect(result.sourceFormat).toBe('markdown')
      expect(result.orderNum).toBe(5)
    })

    it('소유자가 아니면 ForbiddenException을 던진다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(mockEpisode)
      mockWorkRepo.findById.mockResolvedValue(mockWork)

      await expect(
        useCase.getEpisodeRawForOwner('other-author', 'ep-1'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('episode 없으면 NotFoundException을 던진다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(null)

      await expect(
        useCase.getEpisodeRawForOwner('author-1', 'no-ep'),
      ).rejects.toThrow(NotFoundException)
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
