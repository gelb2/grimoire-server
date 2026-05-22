import {
  MEMBERSHIP_MONTHLY_POOL,
  MEMBERSHIP_PRICE_KRW,
  isMembershipTier,
  normalizeMembershipTier,
  monthlyPoolFor,
  resolveTierOrFree,
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

  describe('resolveTierOrFree — CC-5 HIGH-1 案 B 폴백 헬퍼', () => {
    it('plan 이 null 이면 free (멤버십 미가입 작가)', () => {
      expect(resolveTierOrFree(null)).toBe('free')
    })

    it('plan.status 가 cancelled 면 free 다운그레이드', () => {
      expect(resolveTierOrFree({ tier: 'pro', status: 'cancelled' })).toBe('free')
    })

    it('plan.status 가 expired 면 free 다운그레이드', () => {
      expect(resolveTierOrFree({ tier: 'premium', status: 'expired' })).toBe('free')
    })

    it('active + tier=pro 면 pro', () => {
      expect(resolveTierOrFree({ tier: 'pro', status: 'active' })).toBe('pro')
    })

    it('active + tier=premium 면 premium', () => {
      expect(resolveTierOrFree({ tier: 'premium', status: 'active' })).toBe('premium')
    })

    it('active + tier 가 알 수 없는 값이면 free 폴백 (normalizeMembershipTier 정합)', () => {
      expect(resolveTierOrFree({ tier: 'enterprise', status: 'active' })).toBe('free')
    })
  })
})
