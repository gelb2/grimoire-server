import {
  MEMBERSHIP_MONTHLY_POOL,
  MEMBERSHIP_PRICE_KRW,
  isMembershipTier,
  normalizeMembershipTier,
  monthlyPoolFor,
} from './membership-tier'

/**
 * 크레딧 개편 I Phase — 멤버십 등급 + 월 풀 spec.
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-3, S Phase Draft §9.
 */
describe('membership-tier — 구독 등급 + 월 포인트 풀', () => {
  describe('MEMBERSHIP_MONTHLY_POOL — §8-3 cost-accountant v3 확정', () => {
    it('free 풀은 0 (충전 pt 로만 채팅·분석)', () => {
      expect(MEMBERSHIP_MONTHLY_POOL.free).toBe(0)
    })

    it('pro 풀은 93,000 pt (₩9,900)', () => {
      expect(MEMBERSHIP_MONTHLY_POOL.pro).toBe(93000)
    })

    it('premium 풀은 191,500 pt (₩19,900)', () => {
      expect(MEMBERSHIP_MONTHLY_POOL.premium).toBe(191500)
    })
  })

  describe('MEMBERSHIP_PRICE_KRW — §8-3', () => {
    it('Pro 월 가격은 ₩9,900', () => {
      expect(MEMBERSHIP_PRICE_KRW.pro).toBe(9900)
    })

    it('Premium 월 가격은 ₩19,900', () => {
      expect(MEMBERSHIP_PRICE_KRW.premium).toBe(19900)
    })
  })

  describe('isMembershipTier', () => {
    it('free/pro/premium 은 유효', () => {
      expect(isMembershipTier('free')).toBe(true)
      expect(isMembershipTier('pro')).toBe(true)
      expect(isMembershipTier('premium')).toBe(true)
    })

    it('알 수 없는 등급은 무효', () => {
      expect(isMembershipTier('enterprise')).toBe(false)
    })
  })

  describe('normalizeMembershipTier — 마이그레이션 안전망', () => {
    it('유효 등급은 그대로 반환', () => {
      expect(normalizeMembershipTier('pro')).toBe('pro')
    })

    it('알 수 없는 plan 은 free 로 폴백 (migration.sql §B-(c) 정합)', () => {
      expect(normalizeMembershipTier('legacy_unknown')).toBe('free')
    })
  })

  describe('monthlyPoolFor', () => {
    it('등급의 월 풀 크기를 반환', () => {
      expect(monthlyPoolFor('pro')).toBe(93000)
      expect(monthlyPoolFor('premium')).toBe(191500)
      expect(monthlyPoolFor('free')).toBe(0)
    })
  })
})
