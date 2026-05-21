import { CreditController } from './credit.controller'

describe('CreditController', () => {
  let controller: CreditController
  let mockCreditUseCase: { getPointBalance: jest.Mock }

  beforeEach(() => {
    mockCreditUseCase = {
      getPointBalance: jest.fn().mockResolvedValue({
        free: 3000,
        subscription: 0,
        gift: 2000,
        charged: 5000,
        total: 10000,
        deficit: 0,
        available: 10000,
      }),
    }
    controller = new CreditController(mockCreditUseCase as any)
  })

  describe('GET /credits/balance', () => {
    it('크레딧 개편 I Phase — 4 출처 포인트 잔액을 bySource 형태로 반환한다', async () => {
      const res = await controller.getBalance({ user: { sub: 'author-1' } } as any)

      expect(mockCreditUseCase.getPointBalance).toHaveBeenCalledWith('author-1')
      expect(res.total).toBe(10000)
      expect(res.available).toBe(10000)
      expect(res.deficit).toBe(0)
      expect(res.bySource).toEqual({
        free: 3000,
        subscription: 0,
        gift: 2000,
        charged: 5000,
      })
    })
  })
})
