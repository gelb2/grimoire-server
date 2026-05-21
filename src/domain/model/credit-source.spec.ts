import {
  CREDIT_CONSUMPTION_ORDER,
  CREDIT_SOURCE_ACCOUNTING,
  isCreditSource,
  isCreditLedgerType,
} from './credit-source'

/**
 * 크레딧 개편 I Phase — 포인트 출처 4종 + 소진 우선순위 spec.
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-2, S Phase Draft §9.
 */
describe('credit-source — 포인트 출처 4종', () => {
  describe('CREDIT_CONSUMPTION_ORDER — §8-2 소진 우선순위', () => {
    it('소진 우선순위는 무료적립→구독풀→응원선물→충전', () => {
      expect(CREDIT_CONSUMPTION_ORDER).toEqual([
        'free',
        'subscription',
        'gift',
        'charged',
      ])
    })

    it('충전이 마지막 — 영구 보존 자원을 가장 나중에 소진', () => {
      expect(
        CREDIT_CONSUMPTION_ORDER[CREDIT_CONSUMPTION_ORDER.length - 1],
      ).toBe('charged')
    })
  })

  describe('CREDIT_SOURCE_ACCOUNTING — CAC/COGS 회계 분리 (§8-2)', () => {
    it('무료 적립은 CAC (매출 0 — 마케팅비)', () => {
      expect(CREDIT_SOURCE_ACCOUNTING.free).toBe('cac')
    })

    it('충전/구독풀/응원선물은 COGS', () => {
      expect(CREDIT_SOURCE_ACCOUNTING.charged).toBe('cogs')
      expect(CREDIT_SOURCE_ACCOUNTING.subscription).toBe('cogs')
      expect(CREDIT_SOURCE_ACCOUNTING.gift).toBe('cogs')
    })
  })

  describe('isCreditSource', () => {
    it('4 출처는 유효', () => {
      expect(isCreditSource('free')).toBe(true)
      expect(isCreditSource('subscription')).toBe(true)
      expect(isCreditSource('gift')).toBe(true)
      expect(isCreditSource('charged')).toBe(true)
    })

    it('알 수 없는 출처는 무효', () => {
      expect(isCreditSource('bonus')).toBe(false)
    })
  })

  describe('isCreditLedgerType', () => {
    it('5 ledger 타입은 유효', () => {
      expect(isCreditLedgerType('earn')).toBe(true)
      expect(isCreditLedgerType('spend')).toBe(true)
      expect(isCreditLedgerType('deficit_incur')).toBe(true)
      expect(isCreditLedgerType('deficit_settle')).toBe(true)
      expect(isCreditLedgerType('expire')).toBe(true)
    })

    it('알 수 없는 타입은 무효', () => {
      expect(isCreditLedgerType('transfer')).toBe(false)
    })
  })
})
