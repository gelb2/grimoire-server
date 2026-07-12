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

  // CC-2b — 案 G1 transfer (응원 선물 양측 1 트랜잭션)
  describe('transfer — 응원 선물 (案 G1)', () => {
    /** sender(id 알파벳 작) + receiver(id 알파벳 큰) 양측 row 를 IN(...) FOR UPDATE 가 반환 */
    function mockTwoAuthors(
      senderId: string,
      sender: typeof authorRow,
      receiverId: string,
      receiver: typeof authorRow,
    ) {
      const tx = mockPrisma.$transaction
      tx.mockImplementationOnce(async (fn: any) => {
        const inner = {
          $queryRawUnsafe: jest.fn().mockResolvedValue([
            { id: senderId, ...sender },
            { id: receiverId, ...receiver },
          ]),
          author: {
            update: jest.fn().mockImplementation(async (args: any) => {
              authorUpdates.push({ where: args.where, data: args.data })
              return {}
            }),
          },
          creditLedger: {
            create: jest.fn().mockImplementation(async (args: any) => {
              const row = { id: `l-${createdLedgers.length + 1}`, createdAt: new Date(), ...args.data }
              createdLedgers.push(row)
              return row
            }),
          },
        }
        return fn(inner)
      })
    }

    it('1,000pt 선물 — sender charged 차감 spend + receiver gift earn 양측 ledger 박제', async () => {
      mockTwoAuthors(
        'reader-1',
        { points_free: 0, points_subscription: 0, points_gift: 0, points_charged: 5000, deficit_points: 0 },
        'author-1',
        { points_free: 0, points_subscription: 0, points_gift: 0, points_charged: 0, deficit_points: 0 },
      )

      const result = await repo.transfer('reader-1', 'author-1', 1000)

      expect(result.senderSpentBySource).toEqual({
        free: 0, subscription: 0, gift: 0, charged: 1000,
      })
      expect(result.receiverGiftBalance).toBe(1000)

      // ledger row 2건 — sender spend + receiver gift earn
      const spendRow = createdLedgers.find((r) => r.type === 'spend')
      const earnRow = createdLedgers.find((r) => r.type === 'earn')
      expect(spendRow).toMatchObject({
        authorId: 'reader-1',
        source: 'charged',
        type: 'spend',
        amount: -1000,
        reason: 'gift_sent:author-1',
      })
      expect(earnRow).toMatchObject({
        authorId: 'author-1',
        source: 'gift',
        type: 'earn',
        amount: 1000,
        reason: 'gift_received:reader-1',
      })
    })

    it('sender 잔액 부족 — throw (외상 선물 불가)', async () => {
      mockTwoAuthors(
        'reader-2',
        { points_free: 0, points_subscription: 0, points_gift: 0, points_charged: 500, deficit_points: 0 },
        'author-2',
        { points_free: 0, points_subscription: 0, points_gift: 0, points_charged: 0, deficit_points: 0 },
      )

      await expect(repo.transfer('reader-2', 'author-2', 1000)).rejects.toThrow('포인트가 부족')
    })

    it('자기 선물 throw (사전 검증)', async () => {
      await expect(repo.transfer('a', 'a', 1000)).rejects.toThrow('자기')
    })

    it('amount 0 이하 throw', async () => {
      await expect(repo.transfer('a', 'b', 0)).rejects.toThrow('양')
    })

    it('amount 비정수 throw', async () => {
      await expect(repo.transfer('a', 'b', 100.5)).rejects.toThrow('정수')
    })

    it('4 출처 분산 차감 — free 우선 + 잔여 charged', async () => {
      mockTwoAuthors(
        'reader-3',
        { points_free: 500, points_subscription: 0, points_gift: 0, points_charged: 5000, deficit_points: 0 },
        'author-3',
        { points_free: 0, points_subscription: 0, points_gift: 0, points_charged: 0, deficit_points: 0 },
      )

      const result = await repo.transfer('reader-3', 'author-3', 1000)

      expect(result.senderSpentBySource.free).toBe(500)
      expect(result.senderSpentBySource.charged).toBe(500)
      // sender spend ledger 2건 (free + charged) + receiver earn 1건 = 총 3건
      const spendRows = createdLedgers.filter((r) => r.type === 'spend')
      expect(spendRows).toHaveLength(2)
    })

    it('sender/receiver 미존재 throw', async () => {
      const tx = mockPrisma.$transaction
      tx.mockImplementationOnce(async (fn: any) => {
        const inner = {
          $queryRawUnsafe: jest.fn().mockResolvedValue([]),
          author: { update: jest.fn() },
          creditLedger: { create: jest.fn() },
        }
        return fn(inner)
      })
      await expect(repo.transfer('ghost-a', 'ghost-b', 1000)).rejects.toThrow('유저를 찾을 수 없')
    })
  })

  describe('findByAuthor — F-21 기간/페이지 필터', () => {
    it('필터 미전달 시 무필터 최신순 limit 건 (하위호환)', async () => {
      await repo.findByAuthor('author-1', 100)
      expect(mockPrisma.creditLedger.findMany).toHaveBeenCalledWith({
        where: { authorId: 'author-1' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    })

    it('from/to 는 createdAt gte/lte, offset 은 skip 으로 적용된다', async () => {
      const from = new Date('2026-06-01T00:00:00.000Z')
      const to = new Date('2026-07-01T00:00:00.000Z')
      await repo.findByAuthor('author-1', 20, { from, to, offset: 40 })
      expect(mockPrisma.creditLedger.findMany).toHaveBeenCalledWith({
        where: { authorId: 'author-1', createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 40,
      })
    })

    it('from 만 지정 시 gte 만 걸고 skip 은 생략된다', async () => {
      const from = new Date('2026-06-01T00:00:00.000Z')
      await repo.findByAuthor('author-1', 50, { from })
      expect(mockPrisma.creditLedger.findMany).toHaveBeenCalledWith({
        where: { authorId: 'author-1', createdAt: { gte: from } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    })
  })

  describe('getGiftRanking — CC-3 (HIGH-3) 신 ledger 기반 선물 랭킹', () => {
    it("source='gift', type='earn' 만 groupBy(authorId) + 누적 sum desc 정렬", async () => {
      mockPrisma.creditLedger.groupBy = jest.fn().mockResolvedValue([
        { authorId: 'author-A', _sum: { amount: 9000 } },
        { authorId: 'author-B', _sum: { amount: 3000 } },
      ])

      const ranking = await repo.getGiftRanking(10)

      expect(mockPrisma.creditLedger.groupBy).toHaveBeenCalledWith({
        by: ['authorId'],
        where: { source: 'gift', type: 'earn' },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10,
      })
      expect(ranking).toEqual([
        { authorId: 'author-A', totalGifted: 9000 },
        { authorId: 'author-B', totalGifted: 3000 },
      ])
    })

    it('limit 5 등 인자 그대로 전달', async () => {
      mockPrisma.creditLedger.groupBy = jest.fn().mockResolvedValue([])
      await repo.getGiftRanking(5)
      expect(mockPrisma.creditLedger.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      )
    })

    it('_sum.amount 가 null 이면 0 으로 폴백', async () => {
      mockPrisma.creditLedger.groupBy = jest.fn().mockResolvedValue([
        { authorId: 'author-X', _sum: { amount: null } },
      ])
      const ranking = await repo.getGiftRanking(10)
      expect(ranking).toEqual([{ authorId: 'author-X', totalGifted: 0 }])
    })
  })
})
