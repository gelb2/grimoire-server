import { CreditController } from './credit.controller'

describe('CreditController', () => {
  let controller: CreditController
  let mockCreditUseCase: {
    getPointBalance: jest.Mock
    getLogs: jest.Mock
    getSubscriptionExpiry: jest.Mock
  }

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
      getLogs: jest.fn().mockResolvedValue([]),
      getSubscriptionExpiry: jest.fn().mockResolvedValue(null),
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

  describe('GET /credits/logs (F-21 기간/페이지 필터)', () => {
    it('무파라미터 호출 시 options 필드 전부 undefined 로 위임한다 (하위호환)', async () => {
      await controller.getLogs({ user: { sub: 'author-1' } } as any, {} as any)
      expect(mockCreditUseCase.getLogs).toHaveBeenCalledWith('author-1', {
        from: undefined,
        to: undefined,
        limit: undefined,
        offset: undefined,
      })
    })

    it('from/to 를 Date 로 변환하고 limit/offset 을 그대로 위임한다', async () => {
      await controller.getLogs(
        { user: { sub: 'author-1' } } as any,
        { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z', limit: 20, offset: 40 } as any,
      )
      const [, options] = mockCreditUseCase.getLogs.mock.calls[0]
      expect(options.from).toBeInstanceOf(Date)
      expect(options.to).toBeInstanceOf(Date)
      expect(options.from.toISOString()).toBe('2026-06-01T00:00:00.000Z')
      expect(options.limit).toBe(20)
      expect(options.offset).toBe(40)
    })
  })

  describe('GET /credits/expiring (F-21 만료 예정)', () => {
    it('본인 authorId 로 getSubscriptionExpiry 를 위임한다', async () => {
      const expiry = { expiringAmount: 93000, expiresAt: new Date('2026-08-01T00:00:00.000Z') }
      mockCreditUseCase.getSubscriptionExpiry.mockResolvedValue(expiry)

      const res = await controller.getExpiring({ user: { sub: 'author-1' } } as any)

      expect(mockCreditUseCase.getSubscriptionExpiry).toHaveBeenCalledWith('author-1')
      expect(res).toEqual(expiry)
    })

    it('만료 예정 없음(null)을 그대로 반환한다', async () => {
      mockCreditUseCase.getSubscriptionExpiry.mockResolvedValue(null)
      const res = await controller.getExpiring({ user: { sub: 'author-1' } } as any)
      expect(res).toBeNull()
    })
  })
})
