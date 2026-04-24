import { ThemeSlotUseCase } from './theme-slot.usecase'
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'

describe('ThemeSlotUseCase', () => {
  let useCase: ThemeSlotUseCase
  let mockThemeRepo: any
  let mockAuthorRepo: any

  const mockAuthor = { id: 'author-1', plan: 'free', planExpireAt: null, defaultThemeId: null }
  const mockTheme = { id: 'theme-1', authorId: 'author-1', isSlotted: false }

  beforeEach(() => {
    mockThemeRepo = {
      findById: jest.fn().mockResolvedValue(mockTheme),
      countSlottedByAuthorId: jest.fn().mockResolvedValue(0),
      updateSlotStatus: jest.fn().mockResolvedValue({ ...mockTheme, isSlotted: true }),
      findAllByAuthorId: jest.fn().mockResolvedValue([mockTheme]),
      findSlottedByAuthorId: jest.fn().mockResolvedValue([]),
    }
    mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue(mockAuthor),
      updateDefaultThemeId: jest.fn().mockResolvedValue(mockAuthor),
    }
    useCase = new ThemeSlotUseCase(mockThemeRepo, mockAuthorRepo)
  })

  describe('assignSlot', () => {
    it('테마를 슬롯에 배치한다', async () => {
      const result = await useCase.assignSlot('author-1', 'theme-1')
      expect(result.isSlotted).toBe(true)
      expect(mockThemeRepo.updateSlotStatus).toHaveBeenCalledWith('theme-1', true)
    })

    it('슬롯이 가득 차면 BadRequestException', async () => {
      mockThemeRepo.countSlottedByAuthorId.mockResolvedValue(1) // free = 1 슬롯
      await expect(useCase.assignSlot('author-1', 'theme-1')).rejects.toThrow(BadRequestException)
    })

    it('이미 슬롯에 있으면 BadRequestException', async () => {
      mockThemeRepo.findById.mockResolvedValue({ ...mockTheme, isSlotted: true })
      await expect(useCase.assignSlot('author-1', 'theme-1')).rejects.toThrow(BadRequestException)
    })

    it('본인 테마가 아니면 ForbiddenException', async () => {
      mockThemeRepo.findById.mockResolvedValue({ ...mockTheme, authorId: 'other' })
      await expect(useCase.assignSlot('author-1', 'theme-1')).rejects.toThrow(ForbiddenException)
    })

    it('플랜 만료 시 ForbiddenException', async () => {
      mockAuthorRepo.findById.mockResolvedValue({ ...mockAuthor, plan: 'pro', planExpireAt: new Date('2020-01-01') })
      await expect(useCase.assignSlot('author-1', 'theme-1')).rejects.toThrow(ForbiddenException)
    })
  })

  describe('removeFromSlot', () => {
    it('테마를 슬롯에서 제거한다', async () => {
      mockThemeRepo.findById.mockResolvedValue({ ...mockTheme, isSlotted: true })
      mockThemeRepo.updateSlotStatus.mockResolvedValue({ ...mockTheme, isSlotted: false })

      const result = await useCase.removeFromSlot('author-1', 'theme-1')
      expect(result.isSlotted).toBe(false)
    })

    it('슬롯에 없는 테마면 BadRequestException', async () => {
      await expect(useCase.removeFromSlot('author-1', 'theme-1')).rejects.toThrow(BadRequestException)
    })
  })

  describe('activateTheme', () => {
    it('슬롯된 테마를 활성화한다', async () => {
      mockThemeRepo.findById.mockResolvedValue({ ...mockTheme, isSlotted: true })
      const result = await useCase.activateTheme('author-1', 'theme-1')
      expect(mockAuthorRepo.updateDefaultThemeId).toHaveBeenCalledWith('author-1', 'theme-1')
    })

    it('비슬롯 테마는 자동 슬롯 후 활성화한다', async () => {
      const result = await useCase.activateTheme('author-1', 'theme-1')
      expect(mockThemeRepo.updateSlotStatus).toHaveBeenCalledWith('theme-1', true)
      expect(mockAuthorRepo.updateDefaultThemeId).toHaveBeenCalledWith('author-1', 'theme-1')
    })

    it('슬롯 가득 차도 기본 테마가 있으면 auto-evict 후 활성화 (2026-04-24 UX 개선)', async () => {
      // 현재 테마 2(기본 + 슬롯) 사용 중, 테마 1을 새로 활성화
      mockAuthorRepo.findById.mockResolvedValue({ ...mockAuthor, defaultThemeId: 'theme-2' })
      mockThemeRepo.countSlottedByAuthorId.mockResolvedValue(1)  // free 플랜 슬롯 full

      await useCase.activateTheme('author-1', 'theme-1')

      // 기존 기본 테마(theme-2)는 슬롯에서 자동 제외
      expect(mockThemeRepo.updateSlotStatus).toHaveBeenCalledWith('theme-2', false)
      // 새 테마(theme-1)는 슬롯에 배치
      expect(mockThemeRepo.updateSlotStatus).toHaveBeenCalledWith('theme-1', true)
      // 기본 테마 ID 갱신
      expect(mockAuthorRepo.updateDefaultThemeId).toHaveBeenCalledWith('author-1', 'theme-1')
    })

    it('슬롯 가득 차고 기본 테마가 없거나 자기 자신이면 여전히 BadRequestException (방어적)', async () => {
      mockAuthorRepo.findById.mockResolvedValue({ ...mockAuthor, defaultThemeId: null })
      mockThemeRepo.countSlottedByAuthorId.mockResolvedValue(1)
      await expect(useCase.activateTheme('author-1', 'theme-1')).rejects.toThrow(BadRequestException)
    })

    it('시스템 테마는 ForbiddenException', async () => {
      mockThemeRepo.findById.mockResolvedValue({ ...mockTheme, source: 'system' })
      await expect(useCase.activateTheme('author-1', 'theme-1')).rejects.toThrow(ForbiddenException)
    })
  })

  describe('getSlotInfo', () => {
    it('슬롯 현황을 반환한다', async () => {
      const result = await useCase.getSlotInfo('author-1')
      expect(result.plan).toBe('free')
      expect(result.slotLimit).toBe(1)
      expect(result.themes).toHaveLength(1)
    })

    it('작가가 없으면 NotFoundException', async () => {
      mockAuthorRepo.findById.mockResolvedValue(null)
      await expect(useCase.getSlotInfo('no-author')).rejects.toThrow(NotFoundException)
    })
  })
})
