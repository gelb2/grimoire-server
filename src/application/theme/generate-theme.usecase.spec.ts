import { GenerateThemeUseCase } from './generate-theme.usecase'
import { NotFoundException, BadRequestException } from '@nestjs/common'

describe('GenerateThemeUseCase', () => {
  let useCase: GenerateThemeUseCase
  let mockClaudeApi: { generateTheme: jest.Mock }
  let mockThemeRepo: { findByAuthorId: jest.Mock; upsert: jest.Mock; findByAuthorSlug: jest.Mock }
  let mockAuthorRepo: { findById: jest.Mock; findBySlug: jest.Mock; findByEmail: jest.Mock; create: jest.Mock; updateCredits: jest.Mock }
  let mockCreditRepo: { adjustCredits: jest.Mock; findLogsByAuthorId: jest.Mock }

  const mockAuthor = { id: 'author-1', slug: 'deerdevil', name: '테스트', email: 'test@test.com', credits: 3, createdAt: new Date() }
  const mockThemeData = {
    bgPrimary: '#0a0a0a', bgSecondary: '#1a1a1a', textPrimary: '#d4c5a0', textMuted: '#8a7e6b',
    textBright: '#e8dcc8', accent: '#c4a46c', border: '#2a2520',
    fontBody: 'serif' as const, fontHeading: 'serif' as const, fontSize: 'normal' as const,
    animation: 'typing' as const, cardStyle: 'sharp' as const, tone: 'dark' as const,
  }
  const mockTheme = { id: 'theme-1', authorId: 'author-1', preset: 'midnight', overrides: mockThemeData, rawDescription: '어둡고 묵직한', bakedCssUrl: null, updatedAt: new Date() }

  beforeEach(() => {
    mockClaudeApi = { generateTheme: jest.fn().mockResolvedValue(mockThemeData) }
    mockThemeRepo = { findByAuthorId: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue(mockTheme), findByAuthorSlug: jest.fn() }
    mockAuthorRepo = { findById: jest.fn().mockResolvedValue(mockAuthor), findBySlug: jest.fn(), findByEmail: jest.fn(), create: jest.fn(), updateCredits: jest.fn() }
    mockCreditRepo = { adjustCredits: jest.fn().mockResolvedValue({ credits: 2, log: {} }), findLogsByAuthorId: jest.fn() }

    useCase = new GenerateThemeUseCase(
      mockClaudeApi as any,
      mockThemeRepo as any,
      mockAuthorRepo as any,
      mockCreditRepo as any,
    )
  })

  it('테마를 생성하고 DB에 저장한다', async () => {
    const result = await useCase.execute('author-1', '어둡고 묵직한 A24 감성')

    expect(mockCreditRepo.adjustCredits).toHaveBeenCalledWith('author-1', -1, 'theme_generate')
    expect(mockClaudeApi.generateTheme).toHaveBeenCalledWith('어둡고 묵직한 A24 감성')
    expect(mockThemeRepo.upsert).toHaveBeenCalledWith('author-1', 'midnight', mockThemeData, '어둡고 묵직한 A24 감성')
    expect(result).toEqual(mockTheme)
  })

  it('기존 테마가 있으면 theme_regenerate 사유로 차감한다', async () => {
    mockThemeRepo.findByAuthorId.mockResolvedValue(mockTheme)

    await useCase.execute('author-1', '새로운 분위기')

    expect(mockCreditRepo.adjustCredits).toHaveBeenCalledWith('author-1', -1, 'theme_regenerate')
  })

  it('작가가 없으면 NotFoundException을 던진다', async () => {
    mockAuthorRepo.findById.mockResolvedValue(null)

    await expect(useCase.execute('no-author', '테스트')).rejects.toThrow(NotFoundException)
  })

  it('크레딧이 부족하면 BadRequestException을 던진다', async () => {
    mockAuthorRepo.findById.mockResolvedValue({ ...mockAuthor, credits: 0 })

    await expect(useCase.execute('author-1', '테스트')).rejects.toThrow(BadRequestException)
  })

  it('tone이 light이면 preset을 morning으로 설정한다', async () => {
    const lightTheme = { ...mockThemeData, tone: 'light' as const }
    mockClaudeApi.generateTheme.mockResolvedValue(lightTheme)

    await useCase.execute('author-1', '밝은 분위기')

    expect(mockThemeRepo.upsert).toHaveBeenCalledWith('author-1', 'morning', lightTheme, '밝은 분위기')
  })

  it('tone이 sepia이면 preset을 parchment로 설정한다', async () => {
    const sepiaTheme = { ...mockThemeData, tone: 'sepia' as const }
    mockClaudeApi.generateTheme.mockResolvedValue(sepiaTheme)

    await useCase.execute('author-1', '세피아 톤')

    expect(mockThemeRepo.upsert).toHaveBeenCalledWith('author-1', 'parchment', sepiaTheme, '세피아 톤')
  })
})
