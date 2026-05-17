import {
  CREDIT_TO_POINT,
  creditsToPoints,
  pointsToCredits,
  Point,
} from './credit-point'

/**
 * 크레딧 개편 I Phase — 디노미네이션 상수 + Point 값 객체 spec.
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-1, S Phase Draft §9.
 */
describe('credit-point — 디노미네이션', () => {
  describe('CREDIT_TO_POINT 상수', () => {
    it('1 크레딧 = 1,000 pt 디노미네이션 비율이 §8-1 확정값', () => {
      expect(CREDIT_TO_POINT).toBe(1000)
    })
  })

  describe('creditsToPoints', () => {
    it('정수 크레딧을 ×1,000 으로 포인트 환산한다', () => {
      expect(creditsToPoints(100)).toBe(100000)
    })

    it('0 크레딧은 0 포인트', () => {
      expect(creditsToPoints(0)).toBe(0)
    })

    it('dev 측정값 정합 — SUM(credits)=100 → 100,000 pt (마이그레이션 검증 기준)', () => {
      expect(creditsToPoints(100)).toBe(100000)
    })
  })

  describe('pointsToCredits', () => {
    it('포인트를 ÷1,000 으로 크레딧 표시 단위 환산한다', () => {
      expect(pointsToCredits(5000)).toBe(5)
    })
  })

  describe('Point 값 객체', () => {
    it('Point.of 는 음수를 거부한다 (음수 잔액 차단)', () => {
      expect(() => Point.of(-1)).toThrow('음수')
    })

    it('Point.of 는 비정수를 거부한다', () => {
      expect(() => Point.of(1.5)).toThrow('정수')
    })

    it('Point.of 는 무한값을 거부한다', () => {
      expect(() => Point.of(Number.POSITIVE_INFINITY)).toThrow('유한')
    })

    it('Point.zero 는 0 포인트', () => {
      expect(Point.zero().toNumber()).toBe(0)
    })

    it('Point.fromCredits 는 ×1,000 환산 후 Point 생성', () => {
      expect(Point.fromCredits(3).toNumber()).toBe(3000)
    })

    it('add 는 두 포인트를 가산한다', () => {
      expect(Point.of(190).add(Point.of(810)).toNumber()).toBe(1000)
    })

    it('subtract 는 차감하되 잔액 부족 시 throw', () => {
      expect(() => Point.of(100).subtract(Point.of(200))).toThrow('부족')
    })

    it('subtract 는 잔액 충분 시 차감 결과를 반환', () => {
      expect(Point.of(1000).subtract(Point.of(190)).toNumber()).toBe(810)
    })

    it('isSufficientFor 는 잔액 >= 차감액 여부를 판정', () => {
      expect(Point.of(2440).isSufficientFor(2440)).toBe(true)
      expect(Point.of(2439).isSufficientFor(2440)).toBe(false)
    })
  })
})
