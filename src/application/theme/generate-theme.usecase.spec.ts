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
  const mockTheme = { id: 'theme-1', authorId: 'author-1', name: '테마 1', preset: 'custom', overrides: mockThemeData, rawDescription: '어둡고 묵직한', bakedCssUrl: null, isSlotted: false, source: 'ai' as const, updatedAt: new Date() }
  const mockSystemTheme = { id: 'sys-midnight', authorId: null, name: '미드나잇', preset: 'midnight', overrides: mockThemeData, rawDescription: '시스템 프리셋: midnight', bakedCssUrl: null, isSlotted: false, source: 'system' as const, updatedAt: new Date() }

  beforeEach(() => {
    mockClaudeApi = { generateTheme: jest.fn().mockResolvedValue(mockThemeData) }
    mockThemeRepo = {
      countByAuthorId: jest.fn().mockResolvedValue(0),
      countSlottedByAuthorId: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(mockTheme),
      findByAuthorSlug: jest.fn(), findById: jest.fn(), findAllByAuthorId: jest.fn(),
      delete: jest.fn(), update: jest.fn(), updateBakedCssUrl: jest.fn(),
      updateSlotStatus: jest.fn(), findSlottedByAuthorId: jest.fn(), unslotAllByAuthorId: jest.fn(),
      findSystemThemes: jest.fn().mockResolvedValue([mockSystemTheme]),
      findSystemThemeByPreset: jest.fn().mockResolvedValue(mockSystemTheme),
    }
    mockAuthorRepo = { findById: jest.fn().mockResolvedValue(mockAuthor), findBySlug: jest.fn(), findByEmail: jest.fn(), create: jest.fn(), updateCredits: jest.fn(), updatePlan: jest.fn() }
    mockCreditRepo = { adjustCredits: jest.fn().mockResolvedValue({ credits: 2, log: {} }), findLogsByAuthorId: jest.fn() }

    useCase = new GenerateThemeUseCase(
      mockClaudeApi as any, mockThemeRepo as any, mockAuthorRepo as any, mockCreditRepo as any,
    )
  })

  it('AI 테마를 생성하고 DB에 저장한다 (보관 상태)', async () => {
    const result = await useCase.execute('author-1', '어둡고 묵직한 A24 감성')
    expect(mockCreditRepo.adjustCredits).toHaveBeenCalledWith('author-1', -1, 'theme_generate')
    expect(mockClaudeApi.generateTheme).toHaveBeenCalledWith('어둡고 묵직한 A24 감성')
    expect(result).toEqual(mockTheme)
  })

  it('AI 생성 시 슬롯 체크를 하지 않는다 (생성은 자유)', async () => {
    mockThemeRepo.countSlottedByAuthorId.mockResolvedValue(10)
    await useCase.execute('author-1', '새 테마')
    expect(mockThemeRepo.create).toHaveBeenCalled()
  })

  it('작가가 없으면 NotFoundException', async () => {
    mockAuthorRepo.findById.mockResolvedValue(null)
    await expect(useCase.execute('no-author', '테스트')).rejects.toThrow(NotFoundException)
  })

  it('크레딧이 부족하면 BadRequestException', async () => {
    mockAuthorRepo.findById.mockResolvedValue({ ...mockAuthor, credits: 0 })
    // adjustCredits가 트랜잭션 내에서 음수 체크 → 에러 던짐
    mockCreditRepo.adjustCredits.mockRejectedValueOnce(new Error('크레딧이 부족합니다'))
    await expect(useCase.execute('author-1', '테스트')).rejects.toThrow(BadRequestException)
  })

  it('플랜 만기 시 ForbiddenException', async () => {
    const expiredAuthor = { ...mockAuthor, plan: 'pro', planExpireAt: new Date('2020-01-01') }
    mockAuthorRepo.findById.mockResolvedValue(expiredAuthor)
    await expect(useCase.execute('author-1', '테스트')).rejects.toThrow(ForbiddenException)
  })

  it('Claude API 실패 시 크레딧을 환불한다', async () => {
    mockClaudeApi.generateTheme.mockRejectedValue(new Error('API 호출 실패'))
    await expect(useCase.execute('author-1', '테스트 설명')).rejects.toThrow('API 호출 실패')
    expect(mockCreditRepo.adjustCredits).toHaveBeenCalledTimes(2)
    expect(mockCreditRepo.adjustCredits).toHaveBeenNthCalledWith(2, 'author-1', 1, 'theme_generate_refund')
  })

  // ── 시스템 프리셋 테스트 ──

  describe('listPresets', () => {
    it('DB에서 시스템 테마 목록을 반환한다', async () => {
      const presets = await useCase.listPresets()
      expect(mockThemeRepo.findSystemThemes).toHaveBeenCalled()
      expect(presets.length).toBe(1)
      expect(presets[0].name).toBe('midnight')
      expect(presets[0].label).toBe('미드나잇')
    })

    it('각 프리셋에 미리보기 색상 정보가 포함된다', async () => {
      const presets = await useCase.listPresets()
      for (const p of presets) {
        expect(p.preview).toBeDefined()
        expect(p.preview.bgPrimary).toBeDefined()
        expect(p.preview.accent).toBeDefined()
      }
    })
  })

  describe('createFromPreset', () => {
    beforeEach(() => {
      mockThemeRepo.findAllByAuthorId.mockResolvedValue([])
    })

    it('시스템 테마를 복사하여 작가 테마를 생성한다 (크레딧 소모 없음)', async () => {
      await useCase.createFromPreset('author-1', 'midnight')
      expect(mockCreditRepo.adjustCredits).not.toHaveBeenCalled()
      expect(mockThemeRepo.findSystemThemeByPreset).toHaveBeenCalledWith('midnight')
      expect(mockThemeRepo.create).toHaveBeenCalledWith(
        'author-1', '미드나잇', 'midnight', mockThemeData, '프리셋 복사: midnight', 'user',
      )
    })

    it('유효하지 않은 프리셋이면 BadRequestException', async () => {
      mockThemeRepo.findSystemThemeByPreset.mockResolvedValue(null)
      await expect(useCase.createFromPreset('author-1', 'invalid')).rejects.toThrow(BadRequestException)
    })

    it('커스텀 이름을 지정할 수 있다', async () => {
      await useCase.createFromPreset('author-1', 'midnight', '나의 다크 테마')
      expect(mockThemeRepo.create).toHaveBeenCalledWith(
        'author-1', '나의 다크 테마', 'midnight', mockThemeData, '프리셋 복사: midnight', 'user',
      )
    })

    it('동일 프리셋명+source=user 테마가 이미 있으면 기존 테마 반환 (중복 방지)', async () => {
      const existingTheme = { ...mockTheme, id: 'existing-1', preset: 'midnight', source: 'user' as const }
      mockThemeRepo.findAllByAuthorId.mockResolvedValue([existingTheme])
      const result = await useCase.createFromPreset('author-1', 'midnight')
      expect(result).toEqual(existingTheme)
      expect(mockThemeRepo.create).not.toHaveBeenCalled()
    })

    it('같은 프리셋이지만 source=ai면 새로 생성', async () => {
      const aiTheme = { ...mockTheme, preset: 'midnight', source: 'ai' as const }
      mockThemeRepo.findAllByAuthorId.mockResolvedValue([aiTheme])
      await useCase.createFromPreset('author-1', 'midnight')
      expect(mockThemeRepo.create).toHaveBeenCalled()
    })
  })
})
