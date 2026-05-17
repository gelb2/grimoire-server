import {
  CHAT_CHARGE_TIERS,
  ANALYSIS_POINT_COST,
  THEME_POINT_COST,
  resolveChatChargeTier,
  resolveChatChargePoints,
} from './chat-charge-tier'

/**
 * 크레딧 개편 I Phase — 채팅 4구간 차감 + 분석·테마 정액 spec.
 *
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-4, S Phase Draft §9.
 * §8-8 CRITICAL #1 (차감 N 재산출 금지) + #4 (4구간 분리 필수) 검증.
 */
describe('chat-charge-tier — 채팅 4구간 차감', () => {
  describe('CHAT_CHARGE_TIERS 구조 — §8-8 CRITICAL #4 (4구간 필수)', () => {
    it('정확히 4구간이다 (3구간 금지 — P99 꼬리 §0 위반)', () => {
      expect(CHAT_CHARGE_TIERS).toHaveLength(4)
    })

    it('구간 식별자가 short/normal/long/xlong 4종', () => {
      expect(CHAT_CHARGE_TIERS.map((t) => t.tier)).toEqual([
        'short',
        'normal',
        'long',
        'xlong',
      ])
    })

    it('마지막 구간 xlong 의 inputMax 는 Infinity (초장문 분리)', () => {
      expect(CHAT_CHARGE_TIERS[3].inputMax).toBe(Number.POSITIVE_INFINITY)
    })
  })

  describe('차감 N — §8-8 CRITICAL #1 (cost-accountant v3 확정값, 재산출 금지)', () => {
    it('short 차감 N 은 190 pt (스트레스 3.05×)', () => {
      expect(CHAT_CHARGE_TIERS[0].points).toBe(190)
    })

    it('normal 차감 N 은 810 pt (스트레스 3.03×)', () => {
      expect(CHAT_CHARGE_TIERS[1].points).toBe(810)
    })

    it('long 차감 N 은 3,390 pt (스트레스 3.01×)', () => {
      expect(CHAT_CHARGE_TIERS[2].points).toBe(3390)
    })

    it('xlong 차감 N 은 5,520 pt (스트레스 3.00× — 쿠션 0)', () => {
      expect(CHAT_CHARGE_TIERS[3].points).toBe(5520)
    })

    it('분석 정액 차감은 2,440 pt (구 4 크레딧 환산)', () => {
      expect(ANALYSIS_POINT_COST).toBe(2440)
    })

    it('테마 정액 차감은 590 pt (구 1 크레딧 환산)', () => {
      expect(THEME_POINT_COST).toBe(590)
    })
  })

  describe('resolveChatChargeTier — 구간 경계 판정 (off-by-one)', () => {
    it('0 tok → short', () => {
      expect(resolveChatChargeTier(0).tier).toBe('short')
    })

    it('경계 정확히 500 tok → short (이하 포함)', () => {
      expect(resolveChatChargeTier(500).tier).toBe('short')
    })

    it('경계 + 1 = 501 tok → normal (off-by-one)', () => {
      expect(resolveChatChargeTier(501).tier).toBe('normal')
    })

    it('경계 정확히 4,000 tok → normal', () => {
      expect(resolveChatChargeTier(4000).tier).toBe('normal')
    })

    it('경계 + 1 = 4,001 tok → long', () => {
      expect(resolveChatChargeTier(4001).tier).toBe('long')
    })

    it('경계 정확히 12,000 tok → long', () => {
      expect(resolveChatChargeTier(12000).tier).toBe('long')
    })

    it('경계 + 1 = 12,001 tok → xlong', () => {
      expect(resolveChatChargeTier(12001).tier).toBe('xlong')
    })

    it('극단값 100,000 tok → xlong', () => {
      expect(resolveChatChargeTier(100000).tier).toBe('xlong')
    })

    it('음수 input 토큰은 거부한다', () => {
      expect(() => resolveChatChargeTier(-1)).toThrow('0 이상')
    })
  })

  describe('resolveChatChargePoints — 구간 차감액 추출', () => {
    it('200 tok → 190 pt (short)', () => {
      expect(resolveChatChargePoints(200)).toBe(190)
    })

    it('2,000 tok → 810 pt (normal)', () => {
      expect(resolveChatChargePoints(2000)).toBe(810)
    })

    it('8,000 tok → 3,390 pt (long)', () => {
      expect(resolveChatChargePoints(8000)).toBe(3390)
    })

    it('16,000 tok → 5,520 pt (xlong)', () => {
      expect(resolveChatChargePoints(16000)).toBe(5520)
    })

    it('SystemSetting 오버라이드 구간 정의를 주입할 수 있다', () => {
      const customTiers = [
        { tier: 'short' as const, inputMax: 1000, points: 200 },
        { tier: 'normal' as const, inputMax: 5000, points: 900 },
        { tier: 'long' as const, inputMax: 15000, points: 3500 },
        {
          tier: 'xlong' as const,
          inputMax: Number.POSITIVE_INFINITY,
          points: 5600,
        },
      ]
      // 800 tok 은 기본 정의면 normal(810) 이지만 커스텀 경계(1000)면 short(200)
      expect(resolveChatChargePoints(800, customTiers)).toBe(200)
    })
  })
})
