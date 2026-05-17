import {
  expectMigratedAuthor,
  migrationIntegrityCriteria,
  DENOMINATION_FACTOR,
  PreMigrationAuthor,
} from './credit-migration'

/**
 * 크레딧 개편 I Phase — 디노미네이션 마이그레이션 정합 검증 spec.
 *
 * 정본: S Phase Draft §7 단계4 + 마이그레이션 정합성 검증, §9.
 * dev 측정값(2026-05-17): authors 12 / SUM(credits)=100 / credits>0 작가=10.
 * → 마이그레이션 후 기대: SUM(points_charged)=100,000 / CreditLedger charged row=10.
 */
describe('credit-migration — 디노미네이션 마이그레이션 정합', () => {
  describe('DENOMINATION_FACTOR', () => {
    it('마이그레이션 ×1,000 환산 비율이 §8-1 디노미네이션과 일치', () => {
      expect(DENOMINATION_FACTOR).toBe(1000)
    })
  })

  describe('expectMigratedAuthor — 작가별 마이그레이션 기대값 (§B-(a)~(c-3))', () => {
    it('credits 5 작가 → pointsCharged 5,000 (×1,000 전량 충전 분류)', () => {
      const e = expectMigratedAuthor({ id: 'a1', credits: 5, plan: 'free' })
      expect(e.pointsCharged).toBe(5000)
      expect(e.hasChargedLedgerRow).toBe(true)
    })

    it('credits 0 작가 → pointsCharged 0, charged ledger row 없음', () => {
      const e = expectMigratedAuthor({ id: 'a2', credits: 0, plan: 'free' })
      expect(e.pointsCharged).toBe(0)
      expect(e.hasChargedLedgerRow).toBe(false)
    })

    it('free 작가 → 구독 풀 0, subscription ledger row 없음', () => {
      const e = expectMigratedAuthor({ id: 'a3', credits: 10, plan: 'free' })
      expect(e.pointsSubscription).toBe(0)
      expect(e.hasSubscriptionLedgerRow).toBe(false)
      expect(e.membershipTier).toBe('free')
    })

    it('pro 작가 → 구독 풀 93,000, subscription ledger row 생성', () => {
      const e = expectMigratedAuthor({ id: 'a4', credits: 3, plan: 'pro' })
      expect(e.pointsSubscription).toBe(93000)
      expect(e.hasSubscriptionLedgerRow).toBe(true)
      expect(e.membershipTier).toBe('pro')
    })

    it('premium 작가 → 구독 풀 191,500', () => {
      const e = expectMigratedAuthor({ id: 'a5', credits: 0, plan: 'premium' })
      expect(e.pointsSubscription).toBe(191500)
      expect(e.hasSubscriptionLedgerRow).toBe(true)
    })

    it('알 수 없는 plan 작가 → free 로 폴백 (migration §B-(c) CASE 정합)', () => {
      const e = expectMigratedAuthor({
        id: 'a6',
        credits: 2,
        plan: 'legacy_weird',
      })
      expect(e.membershipTier).toBe('free')
      expect(e.pointsSubscription).toBe(0)
    })
  })

  describe('migrationIntegrityCriteria — dev 측정값 정합 (§7 검증 기준)', () => {
    // dev 측정값 재현: authors 12, SUM(credits)=100, credits>0 작가=10
    const devAuthors: PreMigrationAuthor[] = [
      { id: 'a1', credits: 30, plan: 'free' },
      { id: 'a2', credits: 20, plan: 'pro' },
      { id: 'a3', credits: 15, plan: 'free' },
      { id: 'a4', credits: 10, plan: 'premium' },
      { id: 'a5', credits: 8, plan: 'free' },
      { id: 'a6', credits: 7, plan: 'free' },
      { id: 'a7', credits: 4, plan: 'free' },
      { id: 'a8', credits: 3, plan: 'free' },
      { id: 'a9', credits: 2, plan: 'free' },
      { id: 'a10', credits: 1, plan: 'free' },
      { id: 'a11', credits: 0, plan: 'free' }, // credits 0
      { id: 'a12', credits: 0, plan: 'free' }, // credits 0
    ]

    it('dev 측정 합산 검증 — SUM(credits)=100 (테스트 픽션 정합)', () => {
      const sum = devAuthors.reduce((s, a) => s + a.credits, 0)
      expect(sum).toBe(100)
    })

    it('마이그레이션 후 SUM(points_charged) = 100,000 (=100×1,000)', () => {
      const criteria = migrationIntegrityCriteria(devAuthors)
      expect(criteria.expectedSumPointsCharged).toBe(100000)
    })

    it('CreditLedger 초기 charged row 수 = credits>0 작가 수 = 10', () => {
      const criteria = migrationIntegrityCriteria(devAuthors)
      expect(criteria.expectedChargedLedgerRowCount).toBe(10)
    })

    it('빈 작가 집합은 기준값 0', () => {
      const criteria = migrationIntegrityCriteria([])
      expect(criteria.expectedSumPointsCharged).toBe(0)
      expect(criteria.expectedChargedLedgerRowCount).toBe(0)
    })
  })
})
