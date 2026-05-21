import { ChargePointsUseCase } from './charge-points.usecase'
import { BadRequestException } from '@nestjs/common'
import { ANALYSIS_POINT_COST, THEME_POINT_COST } from '@domain/model/chat-charge-tier'

/**
 * 크레딧 개편 I Phase — ChargePointsUseCase spec.
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-4, S Phase Draft §9.
 *
 * 검증: 채팅 4구간 사후 차감 + 잔액 부족 deficit + 분석/테마 사전 차감 + 외상 차단.
 */
describe('ChargePointsUseCase', () => {
  let useCase: ChargePointsUseCase
  let mockLedger: {
    earn: jest.Mock
    spend: jest.Mock
    getBalance: jest.Mock
    settleDeficit: jest.Mock
    findByAuthor: jest.Mock
  }
  let mockSettingRepo: { findByPrefix: jest.Mock }
  let mockAuthorRepo: { findById: jest.Mock }

  const spendResult = (deficit = 0) => ({
    spentBySource: { free: 0, subscription: 0, gift: 0, charged: 0 },
    deficitIncurred: deficit,
    balanceAfter: 1000,
  })

  beforeEach(() => {
    mockLedger = {
      earn: jest.fn().mockResolvedValue({}),
      spend: jest.fn().mockResolvedValue(spendResult()),
      getBalance: jest.fn().mockResolvedValue({
        free: 0,
        subscription: 100000,
        gift: 0,
        charged: 0,
        total: 100000,
        deficit: 0,
        available: 100000,
      }),
      settleDeficit: jest.fn().mockResolvedValue(0),
      findByAuthor: jest.fn().mockResolvedValue([]),
    }
    // SystemSetting 비어 있음 → §8 기본값 폴백
    mockSettingRepo = { findByPrefix: jest.fn().mockResolvedValue([]) }
    mockAuthorRepo = { findById: jest.fn() }

    useCase = new ChargePointsUseCase(
      mockLedger as any,
      mockSettingRepo as any,
      mockAuthorRepo as any,
    )
  })

  describe('chargeChatTurn — 채팅 4구간 사후 차감 (§8-4)', () => {
    it('short 구간 (≤500 tok) — 190 pt 차감', async () => {
      const result = await useCase.chargeChatTurn('author-1', 200, 'msg-1')
      expect(result.tier).toBe('short')
      expect(result.chargedPoints).toBe(190)
      expect(mockLedger.spend).toHaveBeenCalledWith({
        authorId: 'author-1',
        amount: 190,
        reason: 'chat_turn:short',
        relatedId: 'msg-1',
      })
    })

    it('normal 구간 (501~4,000 tok) — 810 pt 차감', async () => {
      const result = await useCase.chargeChatTurn('author-1', 2000)
      expect(result.tier).toBe('normal')
      expect(result.chargedPoints).toBe(810)
    })

    it('long 구간 (4,001~12,000 tok) — 3,390 pt 차감', async () => {
      const result = await useCase.chargeChatTurn('author-1', 8000)
      expect(result.tier).toBe('long')
      expect(result.chargedPoints).toBe(3390)
    })

    it('xlong 구간 (>12,000 tok) — 5,520 pt 차감', async () => {
      const result = await useCase.chargeChatTurn('author-1', 16000)
      expect(result.tier).toBe('xlong')
      expect(result.chargedPoints).toBe(5520)
    })

    it('잔액 부족 시 deficit 발생분을 결과로 반환 (사후 차감)', async () => {
      mockLedger.spend.mockResolvedValue(spendResult(620))
      const result = await useCase.chargeChatTurn('author-1', 2000)
      expect(result.deficitIncurred).toBe(620)
    })

    it('input 토큰이 음수면 BadRequest (§8-8 #3 — 토큰 실측 필수)', async () => {
      await expect(useCase.chargeChatTurn('author-1', -1)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('input 토큰이 NaN 이면 BadRequest', async () => {
      await expect(useCase.chargeChatTurn('author-1', NaN)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('SystemSetting 경계 오버라이드 시 동적 구간 적용', async () => {
      mockSettingRepo.findByPrefix.mockResolvedValue([
        { key: 'chat.tier.boundary.short', value: '3000' },
      ])
      // 2000 tok 은 기본이면 normal(810)이지만 경계 3000 오버라이드면 short(190)
      const result = await useCase.chargeChatTurn('author-1', 2000)
      expect(result.tier).toBe('short')
      expect(result.chargedPoints).toBe(190)
    })
  })

  describe('isChatBlocked — 외상 상한 사전 차단 (게이트 5(c))', () => {
    it('외상이 상한(기본 10,000) 미만이면 차단 안 함', async () => {
      mockLedger.getBalance.mockResolvedValue({
        free: 0,
        subscription: 0,
        gift: 0,
        charged: 0,
        total: 0,
        deficit: 5000,
        available: -5000,
      })
      expect(await useCase.isChatBlocked('author-1')).toBe(false)
    })

    it('외상이 상한 도달 시 차단', async () => {
      mockLedger.getBalance.mockResolvedValue({
        free: 0,
        subscription: 0,
        gift: 0,
        charged: 0,
        total: 0,
        deficit: 10000,
        available: -10000,
      })
      expect(await useCase.isChatBlocked('author-1')).toBe(true)
    })

    it('SystemSetting 외상 상한 오버라이드를 반영', async () => {
      mockSettingRepo.findByPrefix.mockResolvedValue([
        { key: 'credit.deficit.limit', value: '3000' },
      ])
      mockLedger.getBalance.mockResolvedValue({
        free: 0,
        subscription: 0,
        gift: 0,
        charged: 0,
        total: 0,
        deficit: 3000,
        available: -3000,
      })
      expect(await useCase.isChatBlocked('author-1')).toBe(true)
    })
  })

  describe('chargeAnalysis — 분석 사전 차감 (정액 2,440pt)', () => {
    it('잔액 충분 시 ANALYSIS_POINT_COST 차감', async () => {
      await useCase.chargeAnalysis('author-1', 'report-1')
      expect(mockLedger.spend).toHaveBeenCalledWith({
        authorId: 'author-1',
        amount: ANALYSIS_POINT_COST,
        reason: 'novel_analysis',
        relatedId: 'report-1',
      })
    })

    it('잔액 부족 시 BadRequest (분석은 사전 차감 — deficit 불가)', async () => {
      mockLedger.getBalance.mockResolvedValue({
        free: 0,
        subscription: 0,
        gift: 0,
        charged: 100,
        total: 100,
        deficit: 0,
        available: 100,
      })
      await expect(useCase.chargeAnalysis('author-1')).rejects.toThrow(
        BadRequestException,
      )
      expect(mockLedger.spend).not.toHaveBeenCalled()
    })
  })

  describe('refundAnalysis — 분석 실패 환불', () => {
    it('spentBySource 미전달 시 전액 충전 출처로 복원 (구 호환 폴백)', async () => {
      await useCase.refundAnalysis('author-1', 'report-1')
      expect(mockLedger.earn).toHaveBeenCalledWith({
        authorId: 'author-1',
        source: 'charged',
        amount: ANALYSIS_POINT_COST,
        reason: 'novel_analysis_refund',
        relatedId: 'report-1',
      })
    })

    // 크레딧 개편 CC-1 §5-D — 출처별 정확 복원 (무료적립이 charged로 둔갑하는 회계 왜곡 방지)
    it('spentBySource 전달 시 차감된 출처별로 복원한다', async () => {
      // 무료적립 2,000pt + 충전 440pt 로 차감된 분석을 환불
      await useCase.refundAnalysis('author-1', 'report-2', {
        free: 2000,
        subscription: 0,
        gift: 0,
        charged: 440,
      })
      // free 출처 2,000pt 복원
      expect(mockLedger.earn).toHaveBeenCalledWith({
        authorId: 'author-1',
        source: 'free',
        amount: 2000,
        reason: 'novel_analysis_refund',
        relatedId: 'report-2',
      })
      // charged 출처 440pt 복원
      expect(mockLedger.earn).toHaveBeenCalledWith({
        authorId: 'author-1',
        source: 'charged',
        amount: 440,
        reason: 'novel_analysis_refund',
        relatedId: 'report-2',
      })
      // 0인 출처(subscription/gift)는 earn 미호출 → 총 2회
      expect(mockLedger.earn).toHaveBeenCalledTimes(2)
    })

    it('spentBySource 가 단일 출처면 1회만 복원', async () => {
      await useCase.refundAnalysis('author-1', 'report-3', {
        free: 0,
        subscription: 2440,
        gift: 0,
        charged: 0,
      })
      expect(mockLedger.earn).toHaveBeenCalledWith({
        authorId: 'author-1',
        source: 'subscription',
        amount: 2440,
        reason: 'novel_analysis_refund',
        relatedId: 'report-3',
      })
      expect(mockLedger.earn).toHaveBeenCalledTimes(1)
    })
  })

  describe('chargeTheme — 테마 사전 차감 (정액 590pt)', () => {
    it('잔액 충분 시 THEME_POINT_COST 차감', async () => {
      await useCase.chargeTheme('author-1')
      expect(mockLedger.spend).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: THEME_POINT_COST,
          reason: 'theme_generate',
        }),
      )
    })

    it('잔액 부족 시 BadRequest', async () => {
      mockLedger.getBalance.mockResolvedValue({
        free: 0,
        subscription: 0,
        gift: 0,
        charged: 100,
        total: 100,
        deficit: 0,
        available: 100,
      })
      await expect(useCase.chargeTheme('author-1')).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  // 크레딧 개편 CC-1 (2026-05-19) — 테마 생성 실패 환불
  describe('refundTheme — 테마 생성 실패 환불', () => {
    it('차감 포인트(590pt)를 충전 출처로 적립한다', async () => {
      await useCase.refundTheme('author-1', 'theme-1')
      expect(mockLedger.earn).toHaveBeenCalledWith({
        authorId: 'author-1',
        source: 'charged',
        amount: THEME_POINT_COST,
        reason: 'theme_generate_refund',
        relatedId: 'theme-1',
      })
    })
  })
})
