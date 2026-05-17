import { PrismaCreditLedgerRepository } from './prisma-credit-ledger.repository'

/**
 * 크레딧 개편 I Phase — PrismaCreditLedgerRepository spec.
 * 정본: .claude/shared-contracts.md §30, S Phase Draft §9.
 *
 * $transaction 콜백 실행 mock — 소진 우선순위 + deficit + 캐시 갱신 검증.
 * 더미 assertion 0건 — ledger insert 인자 + Author 캐시 갱신 인자 정합 박제.
 */
describe('PrismaCreditLedgerRepository', () => {
  let repo: PrismaCreditLedgerRepository
  let mockPrisma: any
  /** authors 캐시 row — FOR UPDATE raw query 가 반환할 잔액 */
  let authorRow: {
    points_free: number
    points_subscription: number
    points_gift: number
    points_charged: number
    deficit_points: number
  }
  /** tx.creditLedger.create 로 박제된 ledger row 들 */
  let createdLedgers: any[]
  /** tx.author.update 호출 인자들 */
  let authorUpdates: any[]

  beforeEach(() => {
    authorRow = {
      points_free: 1000,
      points_subscription: 5000,
      points_gift: 3000,
      points_charged: 10000,
      deficit_points: 0,
    }
    createdLedgers = []
    authorUpdates = []

    const tx = {
      $queryRawUnsafe: jest.fn().mockImplementation(async () => [authorRow]),
      author: {
        update: jest.fn().mockImplementation(async (args: any) => {
          authorUpdates.push(args.data)
          return {}
        }),
      },
      creditLedger: {
        create: jest.fn().mockImplementation(async (args: any) => {
          const row = {
            id: `ledger-${createdLedgers.length + 1}`,
            createdAt: new Date(),
            expiresAt: null,
            relatedId: null,
            ...args.data,
          }
          createdLedgers.push(row)
          return row
        }),
      },
    }

    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
      creditLedger: { findMany: jest.fn().mockResolvedValue([]) },
      author: { findUnique: jest.fn() },
    }
    repo = new PrismaCreditLedgerRepository(mockPrisma)
  })

  describe('earn — 적립', () => {
    it('적립 시 type=earn ledger insert + 해당 출처 캐시 가산', async () => {
      await repo.earn({
        authorId: 'author-1',
        source: 'charged',
        amount: 25000,
        reason: 'purchase_credit',
      })
      const ledger = createdLedgers[0]
      expect(ledger.type).toBe('earn')
      expect(ledger.source).toBe('charged')
      expect(ledger.amount).toBe(25000)
      // 충전 출처 캐시 10,000 + 25,000 = 35,000
      expect(authorUpdates[0].pointsCharged).toBe(35000)
    })

    it('balanceAfter 는 4 출처 합 + 적립액', async () => {
      await repo.earn({
        authorId: 'author-1',
        source: 'free',
        amount: 3000,
        reason: 'signup_bonus',
      })
      // 1000+5000+3000+10000 + 3000 = 22,000
      expect(createdLedgers[0].balanceAfter).toBe(22000)
    })

    it('적립액 0 이하이면 throw', async () => {
      await expect(
        repo.earn({
          authorId: 'author-1',
          source: 'free',
          amount: 0,
          reason: 'x',
        }),
      ).rejects.toThrow('양수')
    })
  })

  describe('spend — 소진 우선순위 + deficit', () => {
    it('무료적립 충분 시 free 출처에서만 차감 + spend ledger 1건', async () => {
      const result = await repo.spend({
        authorId: 'author-1',
        amount: 500,
        reason: 'chat_turn:short',
      })
      expect(result.spentBySource.free).toBe(500)
      expect(result.deficitIncurred).toBe(0)
      // free 출처 spend ledger (amount 음수)
      const freeSpend = createdLedgers.find(
        (l) => l.type === 'spend' && l.source === 'free',
      )
      expect(freeSpend.amount).toBe(-500)
    })

    it('잔액 부족 시 deficit_incur ledger + Author.deficitPoints 가산', async () => {
      // 전 출처 합 19,000 < 차감 25,000 → deficit 6,000
      const result = await repo.spend({
        authorId: 'author-1',
        amount: 25000,
        reason: 'chat_turn:xlong',
      })
      expect(result.deficitIncurred).toBe(6000)
      const deficitLedger = createdLedgers.find(
        (l) => l.type === 'deficit_incur',
      )
      expect(deficitLedger).toBeDefined()
      expect(deficitLedger.amount).toBe(-6000)
      // deficitPoints 캐시 0 + 6,000
      const deficitUpdate = authorUpdates.find(
        (u) => u.deficitPoints !== undefined,
      )
      expect(deficitUpdate.deficitPoints).toBe(6000)
    })

    it('소진액 0 이하이면 throw', async () => {
      await expect(
        repo.spend({ authorId: 'author-1', amount: -1, reason: 'x' }),
      ).rejects.toThrow('양수')
    })
  })

  describe('settleDeficit — 충전 시 외상 우선 상계', () => {
    it('외상이 있으면 deficit_settle ledger + deficitPoints 차감', async () => {
      authorRow.deficit_points = 5000
      const settled = await repo.settleDeficit('author-1', 25000)
      expect(settled).toBe(5000)
      const settleLedger = createdLedgers.find(
        (l) => l.type === 'deficit_settle',
      )
      expect(settleLedger.amount).toBe(-5000)
      // deficitPoints 5,000 - 5,000 = 0
      expect(authorUpdates[0].deficitPoints).toBe(0)
    })

    it('외상이 0 이면 상계 0 (ledger 미생성)', async () => {
      authorRow.deficit_points = 0
      const settled = await repo.settleDeficit('author-1', 25000)
      expect(settled).toBe(0)
      expect(createdLedgers).toHaveLength(0)
    })
  })

  describe('getBalance', () => {
    it('출처별 잔액 + total + deficit + available 을 반환', async () => {
      mockPrisma.author.findUnique.mockResolvedValue({
        pointsFree: 1000,
        pointsSubscription: 5000,
        pointsGift: 3000,
        pointsCharged: 10000,
        deficitPoints: 2000,
      })
      const balance = await repo.getBalance('author-1')
      expect(balance.total).toBe(19000)
      expect(balance.deficit).toBe(2000)
      expect(balance.available).toBe(17000)
    })
  })
})
