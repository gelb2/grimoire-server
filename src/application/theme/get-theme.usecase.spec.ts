import { GetThemeUseCase } from './get-theme.usecase'
import { NotFoundException, ForbiddenException } from '@nestjs/common'

describe('GetThemeUseCase', () => {
  let useCase: GetThemeUseCase
  let mockThemeRepo: {
    findByAuthorSlug: jest.Mock
    findById: jest.Mock
    findAllByAuthorId: jest.Mock
    update: jest.Mock
    delete: jest.Mock
    countByAuthorId: jest.Mock
    create: jest.Mock
    updateBakedCssUrl: jest.Mock
  }
  let mockWorkRepo: { findByAuthorAndWorkSlug: jest.Mock }

  const mockTheme = {
    id: 'theme-1',
    authorId: 'author-1',
    name: '다크 테마',
    preset: 'midnight',
    overrides: { bgPrimary: '#0a0a0a' },
    rawDescription: '어두운 분위기',
    bakedCssUrl: null,
    updatedAt: new Date(),
  }

  beforeEach(() => {
    mockThemeRepo = {
      findByAuthorSlug: jest.fn(),
      findById: jest.fn(),
      findAllByAuthorId: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      countByAuthorId: jest.fn(),
      create: jest.fn(),
      updateBakedCssUrl: jest.fn(),
    }
    mockWorkRepo = { findByAuthorAndWorkSlug: jest.fn() }

    useCase = new GetThemeUseCase(mockThemeRepo as any, mockWorkRepo as any)
  })

  describe('execute', () => {
    it('작가 슬러그로 테마를 조회한다', async () => {
      mockThemeRepo.findByAuthorSlug.mockResolvedValue(mockTheme)

      const result = await useCase.execute('deerdevil')

      expect(mockThemeRepo.findByAuthorSlug).toHaveBeenCalledWith('deerdevil')
      expect(result).toEqual(mockTheme)
    })

    it('테마가 없으면 NotFoundException을 던진다', async () => {
      mockThemeRepo.findByAuthorSlug.mockResolvedValue(null)

      await expect(useCase.execute('no-author')).rejects.toThrow(NotFoundException)
    })
  })

  describe('resolve', () => {
    it('workSlug가 있으면 작품 테마를 우선 반환한다', async () => {
      const workTheme = { ...mockTheme, id: 'theme-work', name: '작품 전용 테마' }
      mockWorkRepo.findByAuthorAndWorkSlug.mockResolvedValue({ themeId: 'theme-work' })
      mockThemeRepo.findById.mockResolvedValue(workTheme)

      const result = await useCase.resolve('deerdevil', 'my-novel')

      expect(mockWorkRepo.findByAuthorAndWorkSlug).toHaveBeenCalledWith('deerdevil', 'my-novel')
      expect(mockThemeRepo.findById).toHaveBeenCalledWith('theme-work')
      expect(result).toEqual(workTheme)
    })

    it('workSlug가 없으면 작가 기본 테마를 반환한다', async () => {
      mockThemeRepo.findByAuthorSlug.mockResolvedValue(mockTheme)

      const result = await useCase.resolve('deerdevil')

      expect(mockWorkRepo.findByAuthorAndWorkSlug).not.toHaveBeenCalled()
      expect(mockThemeRepo.findByAuthorSlug).toHaveBeenCalledWith('deerdevil')
      expect(result).toEqual(mockTheme)
    })

    it('작품에 themeId가 없으면 작가 기본 테마로 폴백한다', async () => {
      mockWorkRepo.findByAuthorAndWorkSlug.mockResolvedValue({ themeId: null })
      mockThemeRepo.findByAuthorSlug.mockResolvedValue(mockTheme)

      const result = await useCase.resolve('deerdevil', 'my-novel')

      expect(result).toEqual(mockTheme)
    })
  })

  describe('updateOverrides', () => {
    it('본인 테마의 overrides를 수정한다', async () => {
      mockThemeRepo.findById.mockResolvedValue(mockTheme)
      const updatedTheme = { ...mockTheme, overrides: { bgPrimary: '#ffffff' } }
      mockThemeRepo.update.mockResolvedValue(updatedTheme)

      const overrides = { bgPrimary: '#ffffff' } as any
      const result = await useCase.updateOverrides('author-1', 'theme-1', overrides)

      expect(mockThemeRepo.update).toHaveBeenCalledWith('theme-1', 'custom', overrides, 'manual_edit')
      expect(result).toEqual(updatedTheme)
    })

    it('다른 작가의 테마를 수정하면 ForbiddenException을 던진다', async () => {
      mockThemeRepo.findById.mockResolvedValue(mockTheme)

      await expect(
        useCase.updateOverrides('other-author', 'theme-1', {} as any),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('deleteTheme', () => {
    it('본인 테마를 삭제한다', async () => {
      mockThemeRepo.findById.mockResolvedValue(mockTheme)
      mockThemeRepo.delete.mockResolvedValue(undefined)

      await useCase.deleteTheme('author-1', 'theme-1')

      expect(mockThemeRepo.delete).toHaveBeenCalledWith('theme-1')
    })

    it('다른 작가의 테마를 삭제하면 NotFoundException을 던진다', async () => {
      mockThemeRepo.findById.mockResolvedValue(mockTheme)

      await expect(
        useCase.deleteTheme('other-author', 'theme-1'),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('listByAuthor', () => {
    it('작가의 테마 목록을 반환한다', async () => {
      const themes = [mockTheme, { ...mockTheme, id: 'theme-2', name: '밝은 테마' }]
      mockThemeRepo.findAllByAuthorId.mockResolvedValue(themes)

      const result = await useCase.listByAuthor('author-1')

      expect(mockThemeRepo.findAllByAuthorId).toHaveBeenCalledWith('author-1')
      expect(result).toHaveLength(2)
    })
  })
})
