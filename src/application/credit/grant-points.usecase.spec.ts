import { GrantPointsUseCase } from './grant-points.usecase'
import { BadRequestException } from '@nestjs/common'

/**
 * 크레딧 개편 I Phase — GrantPointsUseCase spec.
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-2/§8-4, S Phase Draft §9.
 *
 * 검증: 적립 4출처 + 충전 시 deficit 우선 상계.
 */
describe('GrantPointsUseCase', () => {
  let useCase: GrantPointsUseCase
  let mockLedger: {
    earn: jest.Mock
    spend: jest.Mock
    getBalance: jest.Mock
    settleDeficit: jest.Mock
    findByAuthor: jest.Mock
  }

  beforeEach(() => {
    mockLedger = {
      earn: jest.fn().mockResolvedValue({}),
      spend: jest.fn(),
      getBalance: jest.fn(),
      settleDeficit: jest.fn().mockResolvedValue(0),
      findByAuthor: jest.fn(),
    }
    useCase = new GrantPointsUseCase(mockLedger as any)
  })

  describe('grantSignupBonus — 가입 보너스 (source=free)', () => {
    it('3,000 pt 를 무료 출처로 적립한다 (구 3 크레딧 환산)', async () => {
      await useCase.grantSignupBonus('author-1')
      expect(mockLedger.earn).toHaveBeenCalledWith({
        authorId: 'author-1',
        source: 'free',
        amount: 3000,
        reason: 'signup_bonus',
      })
    })
  })

  describe('grantFirstWorkBonus — 첫 작품 보너스 (source=free)', () => {
    it('2,000 pt 를 무료 출처로 적립한다 (구 2 크레딧 환산)', async () => {
      await useCase.grantFirstWorkBonus('author-1')
      expect(mockLedger.earn).toHaveBeenCalledWith({
        authorId: 'author-1',
        source: 'free',
        amount: 2000,
        reason: 'first_work_bonus',
      })
    })
  })

  describe('grantCharge — 충전 적립 + deficit 우선 상계 (§8-4)', () => {
    it('외상 0 이면 충전액 전부를 충전 출처로 적립', async () => {
      mockLedger.settleDeficit.mockResolvedValue(0)
      const result = await useCase.grantCharge('author-1', 25000, 'payment-1')
      expect(result.settledDeficit).toBe(0)
      expect(result.chargedPoints).toBe(25000)
      expect(mockLedger.earn).toHaveBeenCalledWith({
        authorId: 'author-1',
        source: 'charged',
        amount: 25000,
        reason: 'purchase_credit',
        relatedId: 'payment-1',
      })
    })

    it('외상이 있으면 우선 상계 후 잔액만 적립', async () => {
      // 외상 5,000 → settleDeficit 가 5,000 상계
      mockLedger.settleDeficit.mockResolvedValue(5000)
      const result = await useCase.grantCharge('author-1', 25000)
      expect(result.settledDeficit).toBe(5000)
      expect(result.chargedPoints).toBe(20000)
      expect(mockLedger.earn).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 20000 }),
      )
    })

    it('외상이 충전액 전부를 잠식하면 적립 0 (earn 미호출)', async () => {
      // 충전 3,000 < 외상 → settleDeficit 가 3,000 전부 상계
      mockLedger.settleDeficit.mockResolvedValue(3000)
      const result = await useCase.grantCharge('author-1', 3000)
      expect(result.settledDeficit).toBe(3000)
      expect(result.chargedPoints).toBe(0)
      expect(mockLedger.earn).not.toHaveBeenCalled()
    })

    it('충전 포인트가 0 이하이면 BadRequest', async () => {
      await expect(useCase.grantCharge('author-1', 0)).rejects.toThrow(
        BadRequestException,
      )
      await expect(useCase.grantCharge('author-1', -100)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('deficit 상계는 충전 적립보다 먼저 호출된다 (외상 우선)', async () => {
      const callOrder: string[] = []
      mockLedger.settleDeficit.mockImplementation(async () => {
        callOrder.push('settleDeficit')
        return 1000
      })
      mockLedger.earn.mockImplementation(async () => {
        callOrder.push('earn')
        return {}
      })
      await useCase.grantCharge('author-1', 5000)
      expect(callOrder).toEqual(['settleDeficit', 'earn'])
    })
  })

  describe('grantGift — 응원 선물 수령 (source=gift)', () => {
    it('선물 포인트를 gift 출처로 적립한다', async () => {
      await useCase.grantGift('receiver-1', 3000, 'gift-log-1')
      expect(mockLedger.earn).toHaveBeenCalledWith({
        authorId: 'receiver-1',
        source: 'gift',
        amount: 3000,
        reason: 'gift_received',
        relatedId: 'gift-log-1',
      })
    })

    it('선물 포인트 0 이하이면 BadRequest', async () => {
      await expect(useCase.grantGift('receiver-1', 0)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('grantManual — 운영자 수동 적립', () => {
    it('운영자 지정 출처로 적립하고 reason 에 adminId 박제', async () => {
      await useCase.grantManual('author-1', 'charged', 10000, 'admin-9')
      expect(mockLedger.earn).toHaveBeenCalledWith({
        authorId: 'author-1',
        source: 'charged',
        amount: 10000,
        reason: 'admin_grant_by_admin-9',
      })
    })

    it('적립 포인트 0 이하이면 BadRequest', async () => {
      await expect(
        useCase.grantManual('author-1', 'free', 0, 'admin-9'),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
