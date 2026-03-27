import { GenerateThemeUseCase } from './generate-theme.usecase'
import { NotFoundException, BadRequestException } from '@nestjs/common'

describe('GenerateThemeUseCase', () => {
  let useCase: GenerateThemeUseCase
  let mockClaudeApi: { generateTheme: jest.Mock }
  let mockThemeRepo: { countByAuthorId: jest.Mock; create: jest.Mock; findByAuthorSlug: jest.Mock; findById: jest.Mock; findAllByAuthorId: jest.Mock; delete: jest.Mock; update: jest.Mock; updateBakedCssUrl: jest.Mock }
  let mockAuthorRepo: { findById: jest.Mock; findBySlug: jest.Mock; findByEmail: jest.Mock; create: jest.Mock; updateCredits: jest.Mock }
  let mockCreditRepo: { adjustCredits: jest.Mock; findLogsByAuthorId: jest.Mock }

  const mockAuthor = { id: 'author-1', slug: 'deerdevil', name: '테스트', email: 'test@test.com', credits: 3, createdAt: new Date() }
  const mockThemeData = {
    bgPrimary: '#0a0a0a', bgSecondary: '#1a1a1a', textPrimary: '#d4c5a0', textMuted: '#8a7e6b',
    textBright: '#e8dcc8', accent: '#c4a46c', border: '#2a2520',
    fontBody: 'serif' as const, fontHeading: 'serif' as const, fontSize: 'normal' as const,
    animation: 'typing' as const, cardStyle: 'sharp' as const, tone: 'dark' as const,
  }
  const mockTheme = { id: 'theme-1', authorId: 'author-1', name: '테마 1', preset: 'midnight', overrides: mockThemeData, rawDescription: '어둡고 묵직한', bakedCssUrl: null, updatedAt: new Date() }

  beforeEach(() => {
    mockClaudeApi = { generateTheme: jest.fn().mockResolvedValue(mockThemeData) }
    mockThemeRepo = {
      countByAuthorId: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(mockTheme),
      findByAuthorSlug: jest.fn(),
      findById: jest.fn(),
      findAllByAuthorId: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      updateBakedCssUrl: jest.fn(),
    }
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
    expect(mockThemeRepo.create).toHaveBeenCalledWith('author-1', '테마 1', 'midnight', mockThemeData, '어둡고 묵직한 A24 감성')
    expect(result).toEqual(mockTheme)
  })

  it('슬롯이 가득 차면 BadRequestException을 던진다', async () => {
    mockThemeRepo.countByAuthorId.mockResolvedValue(1) // free 슬롯 1개 초과

    await expect(useCase.execute('author-1', '새 테마')).rejects.toThrow(BadRequestException)
    expect(mockThemeRepo.countByAuthorId).toHaveBeenCalledWith('author-1')
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

    expect(mockThemeRepo.create).toHaveBeenCalledWith('author-1', '테마 1', 'morning', lightTheme, '밝은 분위기')
  })

  it('tone이 sepia이면 preset을 parchment로 설정한다', async () => {
    const sepiaTheme = { ...mockThemeData, tone: 'sepia' as const }
    mockClaudeApi.generateTheme.mockResolvedValue(sepiaTheme)

    await useCase.execute('author-1', '세피아 톤')

    expect(mockThemeRepo.create).toHaveBeenCalledWith('author-1', '테마 1', 'parchment', sepiaTheme, '세피아 톤')
  })

  it('테마 이름을 지정할 수 있다', async () => {
    await useCase.execute('author-1', '어둡고 묵직한', '나의 다크 테마')

    expect(mockThemeRepo.create).toHaveBeenCalledWith('author-1', '나의 다크 테마', 'midnight', mockThemeData, '어둡고 묵직한')
  })
})
