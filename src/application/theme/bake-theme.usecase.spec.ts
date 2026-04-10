import { BakeThemeUseCase } from './bake-theme.usecase'
import { NotFoundException } from '@nestjs/common'

describe('BakeThemeUseCase', () => {
  let useCase: BakeThemeUseCase
  let mockThemeRepo: {
    findByAuthorSlug: jest.Mock
    updateBakedCssUrl: jest.Mock
  }
  let mockBlobStorage: {
    isEnabled: jest.Mock
    uploadThemeCss: jest.Mock
  }

  const mockTheme = {
    id: 'theme-1',
    authorId: 'author-1',
    name: '기본 테마',
    preset: 'midnight',
    overrides: { bgPrimary: '#07070a', textPrimary: '#cdc8bc' },
  }

  beforeEach(() => {
    mockThemeRepo = {
      findByAuthorSlug: jest.fn().mockResolvedValue(mockTheme),
      updateBakedCssUrl: jest.fn().mockResolvedValue(undefined),
    }
    mockBlobStorage = {
      isEnabled: jest.fn().mockReturnValue(false),
      uploadThemeCss: jest.fn(),
    }
    useCase = new BakeThemeUseCase(mockThemeRepo as any, mockBlobStorage as any)
  })

  it('Blob 미설정 시 API 폴백 URL을 반환한다', async () => {
    const result = await useCase.execute('deerdevil')

    expect(result.cssUrl).toBe('/api/themes/css/deerdevil')
    expect(result.css.length).toBeGreaterThan(0)
    expect(mockThemeRepo.updateBakedCssUrl).toHaveBeenCalledWith('theme-1', '/api/themes/css/deerdevil')
    expect(mockBlobStorage.uploadThemeCss).not.toHaveBeenCalled()
  })

  it('Blob 활성화 시 CDN URL을 반환한다', async () => {
    mockBlobStorage.isEnabled.mockReturnValue(true)
    mockBlobStorage.uploadThemeCss.mockResolvedValue('https://storage.blob.core.windows.net/themes/deerdevil.css')

    const result = await useCase.execute('deerdevil')

    expect(result.cssUrl).toBe('https://storage.blob.core.windows.net/themes/deerdevil.css')
    expect(mockBlobStorage.uploadThemeCss).toHaveBeenCalledWith(expect.any(String), 'deerdevil')
    expect(mockThemeRepo.updateBakedCssUrl).toHaveBeenCalledWith(
      'theme-1',
      'https://storage.blob.core.windows.net/themes/deerdevil.css',
    )
  })

  it('CDN 업로드 실패 시 API 폴백으로 처리한다', async () => {
    mockBlobStorage.isEnabled.mockReturnValue(true)
    mockBlobStorage.uploadThemeCss.mockRejectedValue(new Error('upload failed'))

    const result = await useCase.execute('deerdevil')

    expect(result.cssUrl).toBe('/api/themes/css/deerdevil')
  })

  it('테마가 없으면 NotFoundException을 던진다', async () => {
    mockThemeRepo.findByAuthorSlug.mockResolvedValue(null)

    await expect(useCase.execute('no-author')).rejects.toThrow(NotFoundException)
  })

  it('overrides가 null이어도 에러 없이 CSS를 생성한다', async () => {
    mockThemeRepo.findByAuthorSlug.mockResolvedValue({ ...mockTheme, overrides: null })

    const result = await useCase.execute('deerdevil')
    expect(result.css).toBeDefined()
  })
})
