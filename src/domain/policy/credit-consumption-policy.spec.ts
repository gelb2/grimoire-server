import {
  planConsumption,
  settleDeficitOnCharge,
  computeChargeLedgerEntries,
  isChatBlockedByDeficit,
  totalBalance,
  SourceBalances,
} from './credit-consumption-policy'

/**
 * 크레딧 개편 I Phase — 포인트 소진 우선순위 + deficit 상계 정책 spec.
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-2/§8-4, S Phase Draft §9.
 */
describe('credit-consumption-policy — 소진 우선순위 + deficit', () => {
  const balances = (
    free: number,
    subscription: number,
    gift: number,
    charged: number,
  ): SourceBalances => ({ free, subscription, gift, charged })

  describe('planConsumption — 소진 우선순위 (무료적립→구독풀→응원선물→충전)', () => {
    it('무료적립이 충분하면 무료적립에서만 차감', () => {
      const plan = planConsumption(balances(1000, 5000, 3000, 10000), 500)
      expect(plan.spentBySource.free).toBe(500)
      expect(plan.spentBySource.subscription).toBe(0)
      expect(plan.spentBySource.gift).toBe(0)
      expect(plan.spentBySource.charged).toBe(0)
      expect(plan.deficitIncurred).toBe(0)
    })

    it('무료적립 소진 후 구독풀로 넘어간다 (우선순위 2번)', () => {
      const plan = planConsumption(balances(300, 5000, 3000, 10000), 800)
      expect(plan.spentBySource.free).toBe(300)
      expect(plan.spentBySource.subscription).toBe(500)
      expect(plan.spentBySource.gift).toBe(0)
    })

    it('무료+구독 소진 후 응원선물로 넘어간다 (우선순위 3번)', () => {
      const plan = planConsumption(balances(100, 200, 3000, 10000), 810)
      expect(plan.spentBySource.free).toBe(100)
      expect(plan.spentBySource.subscription).toBe(200)
      expect(plan.spentBySource.gift).toBe(510)
      expect(plan.spentBySource.charged).toBe(0)
    })

    it('충전은 마지막에 소진된다 (우선순위 4번 — 영구 보존)', () => {
      const plan = planConsumption(balances(100, 100, 100, 10000), 3390)
      expect(plan.spentBySource.free).toBe(100)
      expect(plan.spentBySource.subscription).toBe(100)
      expect(plan.spentBySource.gift).toBe(100)
      expect(plan.spentBySource.charged).toBe(3090)
      expect(plan.deficitIncurred).toBe(0)
    })

    it('4 출처 모두 소진해도 부족하면 deficit 발생 (채팅 사후 차감 — §8-4)', () => {
      const plan = planConsumption(balances(100, 100, 100, 100), 5520)
      expect(plan.totalSpent).toBe(400)
      expect(plan.deficitIncurred).toBe(5120)
    })

    it('잔액 0 전체에서 차감하면 전액이 deficit', () => {
      const plan = planConsumption(balances(0, 0, 0, 0), 810)
      expect(plan.totalSpent).toBe(0)
      expect(plan.deficitIncurred).toBe(810)
    })

    it('차감액 0 이면 아무 출처도 소진하지 않는다', () => {
      const plan = planConsumption(balances(1000, 1000, 1000, 1000), 0)
      expect(plan.totalSpent).toBe(0)
      expect(plan.deficitIncurred).toBe(0)
    })

    it('음수 차감액은 거부한다', () => {
      expect(() => planConsumption(balances(1000, 0, 0, 0), -100)).toThrow(
        '0 이상',
      )
    })

    it('비정수 차감액은 거부한다', () => {
      expect(() => planConsumption(balances(1000, 0, 0, 0), 1.5)).toThrow(
        '정수',
      )
    })
  })

  describe('settleDeficitOnCharge — 충전 시 외상 우선 상계 (§8-4)', () => {
    it('충전액이 외상보다 크면 외상 전액 상계 후 잔액 적립', () => {
      const r = settleDeficitOnCharge(25000, 5000)
      expect(r.settledDeficit).toBe(5000)
      expect(r.remainingCharge).toBe(20000)
      expect(r.remainingDeficit).toBe(0)
    })

    it('충전액이 외상보다 작으면 충전액 전부로 상계 (적립 0)', () => {
      const r = settleDeficitOnCharge(3000, 10000)
      expect(r.settledDeficit).toBe(3000)
      expect(r.remainingCharge).toBe(0)
      expect(r.remainingDeficit).toBe(7000)
    })

    it('외상이 0 이면 상계 없이 전액 적립', () => {
      const r = settleDeficitOnCharge(41667, 0)
      expect(r.settledDeficit).toBe(0)
      expect(r.remainingCharge).toBe(41667)
    })

    it('충전액 음수는 거부한다', () => {
      expect(() => settleDeficitOnCharge(-1, 1000)).toThrow('0 이상')
    })

    it('외상 잔액 음수는 거부한다', () => {
      expect(() => settleDeficitOnCharge(1000, -1)).toThrow('0 이상')
    })
  })

  describe('isChatBlockedByDeficit — 외상 상한 차단 (게이트 5(c))', () => {
    it('외상이 상한 미만이면 채팅 허용', () => {
      expect(isChatBlockedByDeficit(9999, 10000)).toBe(false)
    })

    it('외상이 상한에 정확히 도달하면 차단', () => {
      expect(isChatBlockedByDeficit(10000, 10000)).toBe(true)
    })

    it('외상이 상한 초과면 차단', () => {
      expect(isChatBlockedByDeficit(15000, 10000)).toBe(true)
    })
  })

  describe('totalBalance', () => {
    it('4 출처 잔액을 합산한다', () => {
      expect(totalBalance(balances(1000, 2000, 3000, 4000))).toBe(10000)
    })
  })

  // CC-2a — 案 1 트랜잭션 통합용 충전 적립 ledger 계획 헬퍼
  describe('computeChargeLedgerEntries — 충전 적립 ledger 박제 계획 (CC-2a)', () => {
    it('deficit < 충전액 — 외상 전액 상계 후 남은 만큼 charged 캐시 가산', () => {
      // 충전 25,000 / 외상 4,000 / 기존 charged 1,000
      const r = computeChargeLedgerEntries(25000, 4000, 1000)
      expect(r.settledDeficit).toBe(4000)
      expect(r.remainingCharge).toBe(21000)
      expect(r.remainingDeficit).toBe(0)
      // charged 캐시 = 기존 1,000 + 남은 충전 21,000 (상계분 4,000 제외)
      expect(r.newChargedCache).toBe(22000)
    })

    it('deficit ≥ 충전액 — 충전액 전부 외상 상계, charged 적립 0', () => {
      // 충전 5,000 / 외상 10,000 (상한 도달 작가) / 기존 charged 0
      const r = computeChargeLedgerEntries(5000, 10000, 0)
      expect(r.settledDeficit).toBe(5000)
      expect(r.remainingCharge).toBe(0)
      expect(r.remainingDeficit).toBe(5000)
      // 충전액 전부 외상 갚는 데 쓰임 → charged 캐시 불변
      expect(r.newChargedCache).toBe(0)
    })

    it('deficit 0 — 충전액 전액이 charged 캐시로 적립', () => {
      // 충전 41,667 / 외상 0 / 기존 charged 8,333
      const r = computeChargeLedgerEntries(41667, 0, 8333)
      expect(r.settledDeficit).toBe(0)
      expect(r.remainingCharge).toBe(41667)
      expect(r.remainingDeficit).toBe(0)
      expect(r.newChargedCache).toBe(50000)
    })

    it('deficit = 충전액 — 경계: 외상 전액 상계 + charged 적립 0 + 외상 0', () => {
      const r = computeChargeLedgerEntries(10000, 10000, 2000)
      expect(r.settledDeficit).toBe(10000)
      expect(r.remainingCharge).toBe(0)
      expect(r.remainingDeficit).toBe(0)
      expect(r.newChargedCache).toBe(2000)
    })

    it('충전 캐시가 음수면 throw', () => {
      expect(() => computeChargeLedgerEntries(25000, 0, -1)).toThrow()
    })

    it('충전액이 음수면 throw (settleDeficitOnCharge 위임 검증)', () => {
      expect(() => computeChargeLedgerEntries(-1, 0, 0)).toThrow()
    })
  })
})
