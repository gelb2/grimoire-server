import { GenerateThemeUseCase } from './generate-theme.usecase'
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common'

describe('GenerateThemeUseCase', () => {
  let useCase: GenerateThemeUseCase
  let mockClaudeApi: { generateTheme: jest.Mock }
  let mockThemeRepo: any
  let mockAuthorRepo: any
  let mockCreditRepo: any

  const mockAuthor = { id: 'author-1', slug: 'deerdevil', name: '테스트', email: 'test@test.com', credits: 3, plan: 'free', planExpireAt: null, createdAt: new Date() }
  const mockThemeData = {
    bgPrimary: '#0a0a0a', bgSecondary: '#1a1a1a', textPrimary: '#d4c5a0', textMuted: '#8a7e6b',
    textBright: '#e8dcc8', textDim: '#4a4740', accent: '#c4a46c', accent2: '#c4a46a', border: '#2a2520',
    fontBody: 'serif' as const, fontHeading: 'serif' as const,
    animation: 'typing' as const, tone: 'dark' as const,
    episodeListLayout: 'series' as const, decorations: { dividerIcon: 'dot' as const, dividerColor: '#c4a46c', headerIcon: 'dot' as const, headerSubtitle: 'TEST', cardAccentPosition: 'left' as const, footerText: 'test' },
  }
  const mockTheme = { id: 'theme-1', authorId: 'author-1', name: '테마 1', preset: 'midnight', overrides: mockThemeData, rawDescription: '어둡고 묵직한', bakedCssUrl: null, isSlotted: true, updatedAt: new Date() }

  beforeEach(() => {
    mockClaudeApi = { generateTheme: jest.fn().mockResolvedValue(mockThemeData) }
    mockThemeRepo = {
      countByAuthorId: jest.fn().mockResolvedValue(0),
      countSlottedByAuthorId: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(mockTheme),
      findByAuthorSlug: jest.fn(), findById: jest.fn(), findAllByAuthorId: jest.fn(),
      delete: jest.fn(), update: jest.fn(), updateBakedCssUrl: jest.fn(),
      updateSlotStatus: jest.fn(), findSlottedByAuthorId: jest.fn(), unslotAllByAuthorId: jest.fn(),
    }
    mockAuthorRepo = { findById: jest.fn().mockResolvedValue(mockAuthor), findBySlug: jest.fn(), findByEmail: jest.fn(), create: jest.fn(), updateCredits: jest.fn(), updatePlan: jest.fn() }
    mockCreditRepo = { adjustCredits: jest.fn().mockResolvedValue({ credits: 2, log: {} }), findLogsByAuthorId: jest.fn() }

    useCase = new GenerateThemeUseCase(
      mockClaudeApi as any, mockThemeRepo as any, mockAuthorRepo as any, mockCreditRepo as any,
    )
  })

  it('테마를 생성하고 DB에 저장한다', async () => {
    const result = await useCase.execute('author-1', '어둡고 묵직한 A24 감성')
    expect(mockCreditRepo.adjustCredits).toHaveBeenCalledWith('author-1', -1, 'theme_generate')
    expect(mockClaudeApi.generateTheme).toHaveBeenCalledWith('어둡고 묵직한 A24 감성')
    expect(result).toEqual(mockTheme)
  })

  it('슬롯이 가득 차면 BadRequestException을 던진다', async () => {
    mockThemeRepo.countSlottedByAuthorId.mockResolvedValue(1)
    await expect(useCase.execute('author-1', '새 테마')).rejects.toThrow(BadRequestException)
  })

  it('작가가 없으면 NotFoundException을 던진다', async () => {
    mockAuthorRepo.findById.mockResolvedValue(null)
    await expect(useCase.execute('no-author', '테스트')).rejects.toThrow(NotFoundException)
  })

  it('크레딧이 부족하면 BadRequestException을 던진다', async () => {
    mockAuthorRepo.findById.mockResolvedValue({ ...mockAuthor, credits: 0 })
    await expect(useCase.execute('author-1', '테스트')).rejects.toThrow(BadRequestException)
  })

  it('플랜 만기 시 ForbiddenException을 던진다', async () => {
    const expiredAuthor = { ...mockAuthor, plan: 'pro', planExpireAt: new Date('2020-01-01') }
    mockAuthorRepo.findById.mockResolvedValue(expiredAuthor)
    await expect(useCase.execute('author-1', '테스트')).rejects.toThrow(ForbiddenException)
  })

  it('tone이 light이면 preset을 morning으로 설정한다', async () => {
    const lightTheme = { ...mockThemeData, tone: 'light' as const }
    mockClaudeApi.generateTheme.mockResolvedValue(lightTheme)
    await useCase.execute('author-1', '밝은 분위기')
    expect(mockThemeRepo.create).toHaveBeenCalledWith('author-1', '테마 1', 'morning', lightTheme, '밝은 분위기')
  })

  it('Claude API 실패 시 크레딧을 환불한다', async () => {
    mockClaudeApi.generateTheme.mockRejectedValue(new Error('API 호출 실패'))
    await expect(useCase.execute('author-1', '테스트 설명')).rejects.toThrow('API 호출 실패')
    expect(mockCreditRepo.adjustCredits).toHaveBeenCalledTimes(2)
    expect(mockCreditRepo.adjustCredits).toHaveBeenNthCalledWith(2, 'author-1', 1, 'theme_generate_refund')
  })
})
