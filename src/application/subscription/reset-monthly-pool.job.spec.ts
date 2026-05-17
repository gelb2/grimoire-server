import { ResetMonthlyPoolJob } from './reset-monthly-pool.job'
import { MembershipPlanState } from '@domain/port/outbound/membership-plan.port'

/**
 * 크레딧 개편 I Phase — ResetMonthlyPoolJob spec.
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-3/§8-6, S Phase Draft §9.
 *
 * 검증: 월간 풀 리셋 + 이월 금지(만료 row 제외) + cron noop + 동시 실행 차단.
 */
describe('ResetMonthlyPoolJob', () => {
  let job: ResetMonthlyPoolJob
  let mockMembershipRepo: {
    getPlan: jest.Mock
    resetMonthlyPool: jest.Mock
    findPlansToReset: jest.Mock
    changeTier: jest.Mock
  }

  const plan = (
    authorId: string,
    tier: 'pro' | 'premium',
  ): MembershipPlanState => ({
    id: `plan-${authorId}`,
    authorId,
    tier,
    monthlyPoolPoints: tier === 'pro' ? 93000 : 191500,
    poolBalance: 5000,
    poolResetAt: new Date('2026-05-01T00:00:00Z'),
    startedAt: new Date('2026-04-01T00:00:00Z'),
    expiresAt: null,
    polarSubscriptionId: null,
    status: 'active',
  })

  beforeEach(() => {
    mockMembershipRepo = {
      getPlan: jest.fn(),
      resetMonthlyPool: jest.fn().mockResolvedValue(undefined),
      findPlansToReset: jest.fn().mockResolvedValue([]),
      changeTier: jest.fn(),
    }
    job = new ResetMonthlyPoolJob(mockMembershipRepo as any)
    delete process.env.MONTHLY_POOL_RESET_DISABLED
  })

  describe('runResetPass — 리셋 1회 수행', () => {
    it('리셋 대상이 없으면 resetCount 0 (noop)', async () => {
      mockMembershipRepo.findPlansToReset.mockResolvedValue([])
      const result = await job.runResetPass(new Date('2026-05-17T04:00:00Z'))
      expect(result.resetCount).toBe(0)
      expect(result.candidateCount).toBe(0)
      expect(mockMembershipRepo.resetMonthlyPool).not.toHaveBeenCalled()
    })

    it('리셋 대상 멤버십을 각각 resetMonthlyPool 호출 (이월 금지 — §8-8 #2)', async () => {
      mockMembershipRepo.findPlansToReset.mockResolvedValue([
        plan('author-1', 'pro'),
        plan('author-2', 'premium'),
      ])
      const now = new Date('2026-05-17T04:00:00Z')
      const result = await job.runResetPass(now)
      expect(result.resetCount).toBe(2)
      expect(result.candidateCount).toBe(2)
      expect(mockMembershipRepo.resetMonthlyPool).toHaveBeenCalledWith(
        'author-1',
        now,
      )
      expect(mockMembershipRepo.resetMonthlyPool).toHaveBeenCalledWith(
        'author-2',
        now,
      )
    })

    it('개별 멤버십 리셋 실패 시 다른 멤버십 처리는 계속한다', async () => {
      mockMembershipRepo.findPlansToReset.mockResolvedValue([
        plan('author-1', 'pro'),
        plan('author-2', 'premium'),
      ])
      mockMembershipRepo.resetMonthlyPool
        .mockRejectedValueOnce(new Error('DB 오류'))
        .mockResolvedValueOnce(undefined)
      const result = await job.runResetPass(new Date('2026-05-17T04:00:00Z'))
      expect(result.resetCount).toBe(1)
      expect(result.failedCount).toBe(1)
    })

    it('findPlansToReset 에 현재 시각을 전달한다 (poolResetAt 경과 판정)', async () => {
      const now = new Date('2026-05-17T04:00:00Z')
      await job.runResetPass(now)
      expect(mockMembershipRepo.findPlansToReset).toHaveBeenCalledWith(now)
    })
  })

  describe('resetExpiredPools — cron 진입점', () => {
    it('MONTHLY_POOL_RESET_DISABLED=1 이면 즉시 return (skip)', async () => {
      process.env.MONTHLY_POOL_RESET_DISABLED = '1'
      await job.resetExpiredPools()
      expect(mockMembershipRepo.findPlansToReset).not.toHaveBeenCalled()
    })

    it('정상 실행 시 runResetPass 를 수행한다', async () => {
      mockMembershipRepo.findPlansToReset.mockResolvedValue([
        plan('author-1', 'pro'),
      ])
      await job.resetExpiredPools()
      expect(mockMembershipRepo.resetMonthlyPool).toHaveBeenCalled()
    })

    it('예외가 나도 throw 하지 않는다 (cron 안정성)', async () => {
      mockMembershipRepo.findPlansToReset.mockRejectedValue(
        new Error('DB 장애'),
      )
      await expect(job.resetExpiredPools()).resolves.not.toThrow()
    })
  })
})
