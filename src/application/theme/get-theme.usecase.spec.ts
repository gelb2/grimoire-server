import { GetThemeUseCase } from './get-theme.usecase'
import { NotFoundException, ForbiddenException } from '@nestjs/common'

describe('GetThemeUseCase', () => {
  let useCase: GetThemeUseCase
  let mockThemeRepo: any
  let mockWorkRepo: any
  let mockAuthorRepo: any

  const mockAuthor = { id: 'author-1', slug: 'deerdevil', name: '테스트', plan: 'free', planExpireAt: null }
  const mockTheme = {
    id: 'theme-1', authorId: 'author-1', name: '다크 테마', preset: 'midnight',
    overrides: { bgPrimary: '#0a0a0a' }, rawDescription: '어두운 분위기',
    bakedCssUrl: null, isSlotted: true, source: 'ai' as const, updatedAt: new Date(),
  }
  const mockSystemTheme = {
    id: 'sys-midnight', authorId: null, name: '미드나잇', preset: 'midnight',
    overrides: { bgPrimary: '#08080e' }, rawDescription: '시스템 프리셋',
    bakedCssUrl: null, isSlotted: false, source: 'system' as const, updatedAt: new Date(),
  }

  beforeEach(() => {
    mockThemeRepo = {
      findByAuthorSlug: jest.fn(), findById: jest.fn(), findAllByAuthorId: jest.fn(),
      update: jest.fn(), delete: jest.fn(), countByAuthorId: jest.fn(), create: jest.fn(),
      updateBakedCssUrl: jest.fn(), countSlottedByAuthorId: jest.fn(),
      updateSlotStatus: jest.fn(), findSlottedByAuthorId: jest.fn(), unslotAllByAuthorId: jest.fn(),
      findSystemThemes: jest.fn().mockResolvedValue([mockSystemTheme]),
      findSystemThemeByPreset: jest.fn().mockResolvedValue(mockSystemTheme),
    }
    mockWorkRepo = { findByAuthorAndWorkSlug: jest.fn() }
    mockAuthorRepo = { findById: jest.fn().mockResolvedValue(mockAuthor), findBySlug: jest.fn().mockResolvedValue(mockAuthor) }

    useCase = new GetThemeUseCase(mockThemeRepo as any, mockWorkRepo as any, mockAuthorRepo as any)
  })

  describe('execute', () => {
    it('작가 슬러그로 테마를 조회한다', async () => {
      mockThemeRepo.findByAuthorSlug.mockResolvedValue(mockTheme)
      const result = await useCase.execute('deerdevil')
      expect(result).toEqual(mockTheme)
    })

    it('테마가 없으면 시스템 폴백 테마(midnight)를 반환한다', async () => {
      mockThemeRepo.findByAuthorSlug.mockResolvedValue(null)
      const result = await useCase.execute('deerdevil')
      expect(mockThemeRepo.findSystemThemeByPreset).toHaveBeenCalledWith('midnight')
      expect(result).toEqual(mockSystemTheme)
    })

    it('플랜 만기 시 시스템 폴백 테마를 반환한다', async () => {
      const expiredAuthor = { ...mockAuthor, plan: 'pro', planExpireAt: new Date('2020-01-01') }
      mockAuthorRepo.findBySlug.mockResolvedValue(expiredAuthor)
      const result = await useCase.execute('deerdevil')
      expect(result).toEqual(mockSystemTheme)
    })
  })

  describe('resolve', () => {
    it('workSlug가 있으면 작품 테마를 우선 반환한다', async () => {
      const workTheme = { ...mockTheme, id: 'theme-work', isSlotted: true }
      mockWorkRepo.findByAuthorAndWorkSlug.mockResolvedValue({ themeId: 'theme-work' })
      mockThemeRepo.findById.mockResolvedValue(workTheme)
      const result = await useCase.resolve('deerdevil', 'my-novel')
      expect(result).toEqual(workTheme)
    })

    it('workSlug가 없으면 작가 기본 테마를 반환한다', async () => {
      mockThemeRepo.findByAuthorSlug.mockResolvedValue(mockTheme)
      const result = await useCase.resolve('deerdevil')
      expect(result).toEqual(mockTheme)
    })
  })

  describe('updateOverrides', () => {
    it('본인 테마의 overrides를 수정한다', async () => {
      mockThemeRepo.findById.mockResolvedValue(mockTheme)
      mockThemeRepo.update.mockResolvedValue({ ...mockTheme, overrides: { bgPrimary: '#ffffff' } })
      await useCase.updateOverrides('author-1', 'theme-1', { bgPrimary: '#ffffff' } as any)
      expect(mockThemeRepo.update).toHaveBeenCalledWith('theme-1', 'midnight', { bgPrimary: '#ffffff' }, 'manual_edit', 'user')
    })

    it('시스템 테마를 수정하면 ForbiddenException', async () => {
      mockThemeRepo.findById.mockResolvedValue(mockSystemTheme)
      await expect(useCase.updateOverrides('author-1', 'sys-midnight', {} as any)).rejects.toThrow(ForbiddenException)
    })

    it('다른 작가의 테마를 수정하면 ForbiddenException', async () => {
      mockThemeRepo.findById.mockResolvedValue(mockTheme)
      await expect(useCase.updateOverrides('other-author', 'theme-1', {} as any)).rejects.toThrow(ForbiddenException)
    })
  })

  describe('deleteTheme', () => {
    it('본인 테마를 삭제한다', async () => {
      mockThemeRepo.findById.mockResolvedValue(mockTheme)
      await useCase.deleteTheme('author-1', 'theme-1')
      expect(mockThemeRepo.delete).toHaveBeenCalledWith('theme-1')
    })

    it('시스템 테마를 삭제하면 ForbiddenException', async () => {
      mockThemeRepo.findById.mockResolvedValue(mockSystemTheme)
      await expect(useCase.deleteTheme('author-1', 'sys-midnight')).rejects.toThrow(ForbiddenException)
    })
  })

  describe('listByAuthor', () => {
    it('작가의 전체 테마 목록을 반환한다 (슬롯 무관)', async () => {
      const themes = [mockTheme, { ...mockTheme, id: 'theme-2', isSlotted: false }]
      mockThemeRepo.findAllByAuthorId.mockResolvedValue(themes)
      const result = await useCase.listByAuthor('author-1')
      expect(result).toHaveLength(2)
    })
  })

  describe('listSystemThemes', () => {
    it('시스템 테마 목록을 반환한다', async () => {
      const result = await useCase.listSystemThemes()
      expect(mockThemeRepo.findSystemThemes).toHaveBeenCalled()
      expect(result).toEqual([mockSystemTheme])
    })
  })
})
