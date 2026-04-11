import { PlanUseCase } from './plan.usecase'
import { NotFoundException, BadRequestException } from '@nestjs/common'

describe('PlanUseCase', () => {
  let useCase: PlanUseCase
  let mockAuthorRepo: any
  let mockThemeRepo: any

  const mockAuthor = { id: 'author-1', plan: 'free', planExpireAt: null }

  beforeEach(() => {
    mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue(mockAuthor),
      updatePlan: jest.fn().mockResolvedValue(undefined),
    }
    mockThemeRepo = {
      countSlottedByAuthorId: jest.fn().mockResolvedValue(1),
      countByAuthorId: jest.fn().mockResolvedValue(3),
      unslotAllByAuthorId: jest.fn().mockResolvedValue(undefined),
    }
    useCase = new PlanUseCase(mockAuthorRepo, mockThemeRepo)
  })

  describe('getPlanInfo', () => {
    it('플랜 정보를 반환한다', async () => {
      const result = await useCase.getPlanInfo('author-1')
      expect(result.plan).toBe('free')
      expect(result.slotLimit).toBe(1)
      expect(result.slottedCount).toBe(1)
      expect(result.totalThemes).toBe(3)
      expect(result.isExpired).toBe(false)
    })

    it('작가가 없으면 NotFoundException', async () => {
      mockAuthorRepo.findById.mockResolvedValue(null)
      await expect(useCase.getPlanInfo('no-author')).rejects.toThrow(NotFoundException)
    })
  })

  describe('activatePlan', () => {
    it('플랜을 활성화하고 만기를 설정한다', async () => {
      await useCase.activatePlan('author-1', 'pro', 30)
      expect(mockAuthorRepo.updatePlan).toHaveBeenCalledWith('author-1', 'pro', expect.any(Date))
    })

    it('free 플랜은 만기 없음', async () => {
      await useCase.activatePlan('author-1', 'free', 30)
      expect(mockAuthorRepo.updatePlan).toHaveBeenCalledWith('author-1', 'free', null)
    })

    it('유효하지 않은 플랜이면 BadRequestException', async () => {
      await expect(useCase.activatePlan('author-1', 'invalid', 30)).rejects.toThrow(BadRequestException)
    })

    it('기간이 0 이하면 BadRequestException', async () => {
      await expect(useCase.activatePlan('author-1', 'pro', 0)).rejects.toThrow(BadRequestException)
    })
  })

  describe('handleExpiry', () => {
    it('만료된 플랜의 테마를 모두 슬롯에서 해제한다', async () => {
      mockAuthorRepo.findById.mockResolvedValue({ id: 'author-1', plan: 'pro', planExpireAt: new Date('2020-01-01') })
      await useCase.handleExpiry('author-1')
      expect(mockThemeRepo.unslotAllByAuthorId).toHaveBeenCalledWith('author-1')
    })

    it('만료되지 않은 플랜은 해제하지 않는다', async () => {
      mockAuthorRepo.findById.mockResolvedValue({ id: 'author-1', plan: 'pro', planExpireAt: new Date('2099-01-01') })
      await useCase.handleExpiry('author-1')
      expect(mockThemeRepo.unslotAllByAuthorId).not.toHaveBeenCalled()
    })
  })
})
