import { PlanUseCase } from './plan.usecase'
import { NotFoundException, BadRequestException } from '@nestjs/common'

/**
 * CC-5 (HIGH-1 案 B) — tier 정본을 MembershipPlan 으로 이행.
 * 案 A 의 `Author.plan`/`authorRepo.updatePlan` mock → `MembershipPlanPort.getPlan`/`changeTier` mock.
 */
describe('PlanUseCase', () => {
  let useCase: PlanUseCase
  let mockAuthorRepo: any
  let mockThemeRepo: any
  let mockMembershipRepo: any

  const mockAuthor = { id: 'author-1', plan: 'free', planExpireAt: null }

  /** MembershipPlanState mock 생성 헬퍼 */
  const planState = (tier: string, status = 'active', expiresAt: Date | null = null) => ({
    id: 'plan-1',
    authorId: 'author-1',
    tier,
    monthlyPoolPoints: 0,
    poolBalance: 0,
    poolResetAt: new Date('2099-01-01'),
    startedAt: new Date('2026-01-01'),
    expiresAt,
    polarSubscriptionId: null,
    status,
  })

  beforeEach(() => {
    mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue(mockAuthor),
    }
    mockThemeRepo = {
      countSlottedByAuthorId: jest.fn().mockResolvedValue(1),
      countByAuthorId: jest.fn().mockResolvedValue(3),
      unslotAllByAuthorId: jest.fn().mockResolvedValue(undefined),
    }
    mockMembershipRepo = {
      getPlan: jest.fn().mockResolvedValue(null), // 기본 — 멤버십 미가입(free)
      changeTier: jest.fn().mockResolvedValue(planState('pro')),
    }
    useCase = new PlanUseCase(mockAuthorRepo, mockThemeRepo, mockMembershipRepo)
  })

  describe('getPlanInfo', () => {
    it('멤버십 미가입 작가는 free 플랜 정보를 반환한다', async () => {
      const result = await useCase.getPlanInfo('author-1')
      expect(result.plan).toBe('free')
      expect(result.slotLimit).toBe(1)
      expect(result.slottedCount).toBe(1)
      expect(result.totalThemes).toBe(3)
      expect(result.isExpired).toBe(false)
    })

    it('pro 멤버십 작가는 pro 등급 + 슬롯 3을 반환한다 (MembershipPlan 정본)', async () => {
      mockMembershipRepo.getPlan.mockResolvedValue(planState('pro'))
      const result = await useCase.getPlanInfo('author-1')
      expect(result.plan).toBe('pro')
      expect(result.slotLimit).toBe(3)
      expect(result.isExpired).toBe(false)
    })

    it('cancelled 멤버십은 free + 만기로 응답한다', async () => {
      mockMembershipRepo.getPlan.mockResolvedValue(planState('pro', 'cancelled'))
      const result = await useCase.getPlanInfo('author-1')
      expect(result.plan).toBe('free')
      expect(result.isExpired).toBe(true)
    })

    it('작가가 없으면 NotFoundException', async () => {
      mockAuthorRepo.findById.mockResolvedValue(null)
      await expect(useCase.getPlanInfo('no-author')).rejects.toThrow(NotFoundException)
    })
  })

  describe('activatePlan', () => {
    it('changeTier 경유로 등급을 변경한다 (직접 updatePlan SQL 0건)', async () => {
      await useCase.activatePlan('author-1', 'pro', 30)
      expect(mockMembershipRepo.changeTier).toHaveBeenCalledWith('author-1', 'pro', expect.any(Date))
    })

    it('free 플랜도 changeTier 경유', async () => {
      await useCase.activatePlan('author-1', 'free', 30)
      expect(mockMembershipRepo.changeTier).toHaveBeenCalledWith('author-1', 'free', expect.any(Date))
    })

    it('유효하지 않은 플랜이면 BadRequestException', async () => {
      await expect(useCase.activatePlan('author-1', 'invalid', 30)).rejects.toThrow(BadRequestException)
    })

    it('기간이 0 이하면 BadRequestException', async () => {
      await expect(useCase.activatePlan('author-1', 'pro', 0)).rejects.toThrow(BadRequestException)
    })
  })

  describe('handleExpiry', () => {
    it('만료된(cancelled) 멤버십의 테마를 모두 슬롯에서 해제한다', async () => {
      mockMembershipRepo.getPlan.mockResolvedValue(planState('pro', 'cancelled'))
      await useCase.handleExpiry('author-1')
      expect(mockThemeRepo.unslotAllByAuthorId).toHaveBeenCalledWith('author-1')
    })

    it('active 멤버십은 해제하지 않는다', async () => {
      mockMembershipRepo.getPlan.mockResolvedValue(planState('pro', 'active'))
      await useCase.handleExpiry('author-1')
      expect(mockThemeRepo.unslotAllByAuthorId).not.toHaveBeenCalled()
    })
  })
})
