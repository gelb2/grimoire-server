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

    it('expiresAt/planExpireAt 을 nextResetAt 로 미러 갱신 (changeTier 규약 정합 — 표시 stale 방지, S-8)', async () => {
      await repo.resetMonthlyPool('author-1', new Date('2026-05-17T04:00:00Z'))
      // 6월 1일 00:00 UTC (nextMonthStart) — poolResetAt 과 동일 미러
      expect(planUpdates[0].poolResetAt).toBeInstanceOf(Date)
      expect(planUpdates[0].expiresAt).toBeInstanceOf(Date)
      expect(planUpdates[0].expiresAt.getTime()).toBe(planUpdates[0].poolResetAt.getTime())
      expect(planUpdates[0].expiresAt.getUTCMonth()).toBe(5)
      expect(planUpdates[0].expiresAt.getUTCDate()).toBe(1)
      expect(authorUpdates[0].planExpireAt).toBeInstanceOf(Date)
      expect(authorUpdates[0].planExpireAt.getTime()).toBe(planUpdates[0].poolResetAt.getTime())
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

  describe('changeTier — Author.plan 양측 동기 (CC-3 HIGH-1 案 A)', () => {
    it('pro 전환 시 Author.plan="pro" + planExpireAt=poolResetAt 동기 갱신', async () => {
      const now = new Date('2026-05-17T00:00:00Z')
      await repo.changeTier('author-1', 'pro', now)
      // tx.author.update 호출 — plan + planExpireAt 동기 검증
      const planSync = authorUpdates.find(
        (u) => u.plan !== undefined,
      )
      expect(planSync).toBeDefined()
      expect(planSync.plan).toBe('pro')
      // planExpireAt = poolResetAt (nextMonthStart) — pro 미러 정책
      expect(planSync.planExpireAt).toBeInstanceOf(Date)
      // 6월 1일 00:00 UTC
      expect(planSync.planExpireAt.getUTCMonth()).toBe(5)
      expect(planSync.planExpireAt.getUTCDate()).toBe(1)
    })

    it('free 전환 시 Author.plan="free" + planExpireAt=null 동기 갱신', async () => {
      const now = new Date('2026-05-17T00:00:00Z')
      await repo.changeTier('author-1', 'free', now)
      const planSync = authorUpdates.find(
        (u) => u.plan !== undefined,
      )
      expect(planSync).toBeDefined()
      expect(planSync.plan).toBe('free')
      // free 는 만기 없음 — null
      expect(planSync.planExpireAt).toBeNull()
    })

    it('MembershipPlan.tier 도 함께 갱신 (양측 정합)', async () => {
      await repo.changeTier('author-1', 'premium', new Date('2026-05-17T00:00:00Z'))
      const planUpdate = planUpdates[0]
      expect(planUpdate.tier).toBe('premium')
      expect(planUpdate.monthlyPoolPoints).toBe(191500)
    })

    it('Author.plan 동기와 MembershipPlan.tier 갱신이 같은 $transaction', async () => {
      // tx 동일 객체에서 양측 호출됨을 검증 — $transaction 1회 호출
      await repo.changeTier('author-1', 'pro', new Date('2026-05-17T00:00:00Z'))
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
      // MembershipPlan + Author 양측 update 모두 발생
      expect(planUpdates.length).toBeGreaterThan(0)
      expect(authorUpdates.find((u) => u.plan !== undefined)).toBeDefined()
    })

    // CC-5 (PAY-P1-4) — 구독 webhook 매핑 + status/expiresAt 정합
    it('polarSubscriptionId 전달 시 MembershipPlan.polarSubscriptionId 갱신', async () => {
      await repo.changeTier('author-1', 'pro', new Date('2026-05-17T00:00:00Z'), 'sub_polar_123')
      expect(planUpdates[0].polarSubscriptionId).toBe('sub_polar_123')
    })

    it('polarSubscriptionId 미전달 시 polarSubscriptionId 키 없음 (기존 매핑 보존)', async () => {
      await repo.changeTier('author-1', 'pro', new Date('2026-05-17T00:00:00Z'))
      expect(planUpdates[0].polarSubscriptionId).toBeUndefined()
    })

    it('pro 전환 시 status="active" + expiresAt=poolResetAt', async () => {
      await repo.changeTier('author-1', 'pro', new Date('2026-05-17T00:00:00Z'))
      expect(planUpdates[0].status).toBe('active')
      expect(planUpdates[0].expiresAt).toBeInstanceOf(Date)
    })

    it('free 다운그레이드 시 status="cancelled" + expiresAt=now (즉시 만료)', async () => {
      const now = new Date('2026-05-17T00:00:00Z')
      await repo.changeTier('author-1', 'free', now)
      expect(planUpdates[0].status).toBe('cancelled')
      expect(planUpdates[0].expiresAt).toEqual(now)
    })
  })

  describe('checkAndResetExpiredPool — lazy 안전망 (CC-3 CRITICAL-1 案 B)', () => {
    it("plan 이 null 이면 no-op {reset:false, plan:null} 반환", async () => {
      mockPrisma.membershipPlan.findFirst.mockResolvedValue(null)
      const result = await repo.checkAndResetExpiredPool(
        'author-x',
        new Date('2026-05-20T00:00:00Z'),
      )
      expect(result.reset).toBe(false)
      expect(result.plan).toBeNull()
      // $transaction 호출 0건 (no-op)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it("tier='free' 면 no-op 반환 (resetMonthlyPool 미호출)", async () => {
      const freePlan = { ...proPlan, tier: 'free', monthlyPoolPoints: 0 }
      mockPrisma.membershipPlan.findFirst.mockResolvedValue(freePlan)
      const result = await repo.checkAndResetExpiredPool(
        'author-1',
        new Date('2026-05-20T00:00:00Z'),
      )
      expect(result.reset).toBe(false)
      expect(result.plan?.tier).toBe('free')
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it("status!='active' 면 no-op 반환", async () => {
      const cancelledPlan = { ...proPlan, status: 'cancelled' }
      mockPrisma.membershipPlan.findFirst.mockResolvedValue(cancelledPlan)
      const result = await repo.checkAndResetExpiredPool(
        'author-1',
        new Date('2026-05-20T00:00:00Z'),
      )
      expect(result.reset).toBe(false)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('poolResetAt > now 면 no-op 반환 (현 풀 유효)', async () => {
      const futurePlan = {
        ...proPlan,
        poolResetAt: new Date('2026-06-01T00:00:00Z'),
      }
      mockPrisma.membershipPlan.findFirst.mockResolvedValue(futurePlan)
      const result = await repo.checkAndResetExpiredPool(
        'author-1',
        new Date('2026-05-20T00:00:00Z'),
      )
      expect(result.reset).toBe(false)
      expect(result.plan?.poolResetAt.toISOString()).toBe(
        '2026-06-01T00:00:00.000Z',
      )
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('poolResetAt <= now (만료) → resetMonthlyPool 호출 + {reset:true}', async () => {
      const expiredPlan = {
        ...proPlan,
        poolResetAt: new Date('2026-05-01T00:00:00Z'),
      }
      mockPrisma.membershipPlan.findFirst.mockResolvedValue(expiredPlan)
      const result = await repo.checkAndResetExpiredPool(
        'author-1',
        new Date('2026-05-20T00:00:00Z'),
      )
      expect(result.reset).toBe(true)
      // resetMonthlyPool 의 $transaction 호출됐는지 확인
      expect(mockPrisma.$transaction).toHaveBeenCalled()
    })
  })
})
