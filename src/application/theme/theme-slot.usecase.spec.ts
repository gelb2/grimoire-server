import { ThemeSlotUseCase } from './theme-slot.usecase'
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'

describe('ThemeSlotUseCase', () => {
  let useCase: ThemeSlotUseCase
  let mockThemeRepo: any
  let mockAuthorRepo: any

  const mockAuthor = { id: 'author-1', plan: 'free', planExpireAt: null }
  const mockTheme = { id: 'theme-1', authorId: 'author-1', isSlotted: false }

  beforeEach(() => {
    mockThemeRepo = {
      findById: jest.fn().mockResolvedValue(mockTheme),
      countSlottedByAuthorId: jest.fn().mockResolvedValue(0),
      updateSlotStatus: jest.fn().mockResolvedValue({ ...mockTheme, isSlotted: true }),
      findAllByAuthorId: jest.fn().mockResolvedValue([mockTheme]),
    }
    mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue(mockAuthor),
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
