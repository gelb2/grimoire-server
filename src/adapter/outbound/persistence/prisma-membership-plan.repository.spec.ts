import { PrismaMembershipPlanRepository } from './prisma-membership-plan.repository'

/**
 * 크레딧 개편 I Phase — PrismaMembershipPlanRepository spec.
 * 정본: .claude/shared-contracts.md §30, S Phase Draft §9.
 *
 * 검증: 월간 리셋 시 이월 금지(만료 ledger) + 풀 재설정 + 캐시 동기.
 */
describe('PrismaMembershipPlanRepository', () => {
  let repo: PrismaMembershipPlanRepository
  let mockPrisma: any
  let createdLedgers: any[]
  let planUpdates: any[]
  let authorUpdates: any[]

  const proPlan = {
    id: 'plan-1',
    authorId: 'author-1',
    tier: 'pro',
    monthlyPoolPoints: 93000,
    poolBalance: 5000, // 잔여 풀 (이월되면 안 됨)
    poolResetAt: new Date('2026-05-01T00:00:00Z'),
    startedAt: new Date('2026-04-01T00:00:00Z'),
    expiresAt: null,
    polarSubscriptionId: null,
    status: 'active',
  }

  beforeEach(() => {
    createdLedgers = []
    planUpdates = []
    authorUpdates = []

    const tx = {
      membershipPlan: {
        findFirst: jest.fn().mockResolvedValue(proPlan),
        update: jest.fn().mockImplementation(async (args: any) => {
          planUpdates.push(args.data)
          return { ...proPlan, ...args.data }
        }),
        create: jest.fn(),
      },
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValue([{ points_subscription: 5000 }]),
      author: {
        update: jest.fn().mockImplementation(async (args: any) => {
          authorUpdates.push(args.data)
          return {}
        }),
      },
      creditLedger: {
        create: jest.fn().mockImplementation(async (args: any) => {
          createdLedgers.push(args.data)
          return args.data
        }),
      },
    }

    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
      membershipPlan: {
        findFirst: jest.fn().mockResolvedValue(proPlan),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    repo = new PrismaMembershipPlanRepository(mockPrisma)
  })

  describe('resetMonthlyPool — 월간 리셋 (이월 금지 — §8-8 #2)', () => {
    it('잔여 풀을 expire ledger 로 만료 처리한다 (이월 X)', async () => {
      await repo.resetMonthlyPool('author-1', new Date('2026-05-17T04:00:00Z'))
      const expireLedger = createdLedgers.find((l) => l.type === 'expire')
      expect(expireLedger).toBeDefined()
      // 잔여 캐시 5,000 만큼 음수 expire
      expect(expireLedger.amount).toBe(-5000)
      expect(expireLedger.source).toBe('subscription')
    })

    it('신규 풀을 earn ledger 로 적립하고 expiresAt 을 설정한다', async () => {
      const now = new Date('2026-05-17T04:00:00Z')
      await repo.resetMonthlyPool('author-1', now)
      const earnLedger = createdLedgers.find((l) => l.type === 'earn')
      expect(earnLedger.amount).toBe(93000) // pro 풀
      expect(earnLedger.expiresAt).toBeInstanceOf(Date)
    })

    it('poolBalance 를 monthlyPoolPoints 로 재설정한다 (이월 없이 덮어씀)', async () => {
      await repo.resetMonthlyPool('author-1', new Date('2026-05-17T04:00:00Z'))
      const planUpdate = planUpdates[0]
      // 잔여 5,000 + 93,000 이 아니라 정확히 93,000 (이월 X)
      expect(planUpdate.poolBalance).toBe(93000)
      expect(planUpdate.monthlyPoolPoints).toBe(93000)
    })

    it('Author.pointsSubscription 캐시를 이번 달 풀로 동기 (이월 X)', async () => {
      await repo.resetMonthlyPool('author-1', new Date('2026-05-17T04:00:00Z'))
      // 잔여 5,000 이 아니라 93,000 으로 덮어씀
      expect(authorUpdates[0].pointsSubscription).toBe(93000)
    })

    it('활성 멤버십이 없으면 throw', async () => {
      const tx = {
        membershipPlan: { findFirst: jest.fn().mockResolvedValue(null) },
      }
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx))
      await expect(
        repo.resetMonthlyPool('author-x', new Date()),
      ).rejects.toThrow('활성 멤버십')
    })
  })

  describe('findPlansToReset — 리셋 대상 조회', () => {
    it('poolResetAt 경과 + active + pro/premium 만 조회한다', async () => {
      const now = new Date('2026-05-17T04:00:00Z')
      await repo.findPlansToReset(now)
      expect(mockPrisma.membershipPlan.findMany).toHaveBeenCalledWith({
        where: {
          status: 'active',
          poolResetAt: { lte: now },
          tier: { in: ['pro', 'premium'] },
        },
      })
    })
  })

  describe('getPlan', () => {
    it('활성 멤버십을 조회한다', async () => {
      const plan = await repo.getPlan('author-1')
      expect(plan?.tier).toBe('pro')
      expect(plan?.monthlyPoolPoints).toBe(93000)
    })

    it('활성 멤버십이 없으면 null', async () => {
      mockPrisma.membershipPlan.findFirst.mockResolvedValue(null)
      expect(await repo.getPlan('author-x')).toBeNull()
    })
  })
})
