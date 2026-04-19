import { PolarAdapter } from './polar.adapter'

// Polar SDK 모킹 — 실제 HTTP 호출 방지
const mockCreate = jest.fn()
jest.mock('@polar-sh/sdk', () => ({
  Polar: jest.fn().mockImplementation(() => ({
    checkouts: { create: mockCreate },
  })),
}))

// validateEvent 모킹 — 로컬 래퍼 모듈을 mock
// jest.mock는 호이스팅되므로 factory 내부에서 외부 변수 참조 불가 (mock* prefix만 예외).
const mockValidateEvent = jest.fn()
jest.mock('./polar-webhooks', () => ({
  validateEvent: (...args: unknown[]) => mockValidateEvent(...args),
  WebhookVerificationError: class WebhookVerificationError extends Error {},
}))

describe('PolarAdapter', () => {
  let adapter: PolarAdapter

  beforeEach(() => {
    mockCreate.mockReset()
    mockValidateEvent.mockReset()
    process.env.POLAR_ACCESS_TOKEN = 'test-token'
    process.env.POLAR_SERVER = 'sandbox'
    process.env.POLAR_WEBHOOK_SECRET = 'test-secret'
    process.env.POLAR_PRODUCT_BASIC = 'polar-prod-basic-uuid'
    process.env.POLAR_PRODUCT_POPULAR = 'polar-prod-popular-uuid'
    process.env.POLAR_PRODUCT_BEST = 'polar-prod-best-uuid'
    adapter = new PolarAdapter()
  })

  afterEach(() => {
    delete process.env.POLAR_ACCESS_TOKEN
    delete process.env.POLAR_SERVER
    delete process.env.POLAR_WEBHOOK_SECRET
    delete process.env.POLAR_PRODUCT_BASIC
    delete process.env.POLAR_PRODUCT_POPULAR
    delete process.env.POLAR_PRODUCT_BEST
  })

  describe('initiatePayment', () => {
    it('내부 상품 ID를 환경변수로 Polar UUID에 매핑한다', async () => {
      mockCreate.mockResolvedValue({
        id: 'checkout-123',
        url: 'https://polar.sh/checkout/abc',
      })

      const result = await adapter.initiatePayment({
        productId: 'credit-5',
        productName: '5 크레딧',
        amount: 1000, // ₩1,000
        userId: 'author-1',
        returnUrl: 'https://grimoire-book.com/return',
      })

      expect(mockCreate).toHaveBeenCalledWith({
        products: ['polar-prod-basic-uuid'],
        successUrl: 'https://grimoire-book.com/return',
        metadata: {
          authorId: 'author-1',
          internalProductId: 'credit-5',
        },
      })
      expect(result.paymentUrl).toBe('https://polar.sh/checkout/abc')
      expect(result.tradeNo).toBe('checkout-123')
    })

    it('credit-20 → POLAR_PRODUCT_POPULAR 매핑', async () => {
      mockCreate.mockResolvedValue({ id: 'c2', url: 'https://polar.sh/c2' })

      await adapter.initiatePayment({
        productId: 'credit-20',
        productName: '20 크레딧',
        amount: 3000,
        userId: 'author-1',
        returnUrl: 'https://example.com',
      })

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ products: ['polar-prod-popular-uuid'] }),
      )
    })

    it('credit-50 → POLAR_PRODUCT_BEST 매핑', async () => {
      mockCreate.mockResolvedValue({ id: 'c3', url: 'https://polar.sh/c3' })

      await adapter.initiatePayment({
        productId: 'credit-50',
        productName: '50 크레딧',
        amount: 5000,
        userId: 'author-1',
        returnUrl: 'https://example.com',
      })

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ products: ['polar-prod-best-uuid'] }),
      )
    })

    it('존재하지 않는 상품 ID면 에러를 던진다', async () => {
      await expect(
        adapter.initiatePayment({
          productId: 'credit-999',
          productName: '없음',
          amount: 0,
          userId: 'author-1',
          returnUrl: 'https://example.com',
        }),
      ).rejects.toThrow('Polar product ID 매핑 실패')
    })

    it('환경변수 누락 시 에러를 던진다', async () => {
      delete process.env.POLAR_PRODUCT_BASIC
      const badAdapter = new PolarAdapter()

      await expect(
        badAdapter.initiatePayment({
          productId: 'credit-5',
          productName: '5 크레딧',
          amount: 1000, // ₩1,000
          userId: 'author-1',
          returnUrl: 'https://example.com',
        }),
      ).rejects.toThrow('Polar product ID 매핑 실패')
    })

    it('Polar SDK 오류 시 래핑된 에러를 던진다', async () => {
      mockCreate.mockRejectedValue(new Error('Stripe down'))

      await expect(
        adapter.initiatePayment({
          productId: 'credit-5',
          productName: '5 크레딧',
          amount: 1000, // ₩1,000
          userId: 'author-1',
          returnUrl: 'https://example.com',
        }),
      ).rejects.toThrow('Polar checkout 생성 실패')
    })
  })

  describe('verifyAndParseWebhook', () => {
    const dummyBody = Buffer.from('{"type":"order.paid","data":{}}')
    const dummyHeaders = {
      'webhook-id': 'msg_123',
      'webhook-timestamp': '1712345678',
      'webhook-signature': 'v1,abc',
    }

    it('order.paid 이벤트를 성공으로 정규화한다', () => {
      mockValidateEvent.mockReturnValue({
        type: 'order.paid',
        data: {
          id: 'order-1',
          checkoutId: 'checkout-abc',
          totalAmount: 149,
          status: 'paid',
          metadata: { authorId: 'author-1', internalProductId: 'credit-5' },
        },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result).toEqual({
        type: 'order.paid',
        tradeNo: 'checkout-abc',
        amount: 2000, // 149센트 → ₩2,000 (credit-5 상품 매핑, F1 2026-04-19 인상 반영)
        status: 'success',
        userId: 'author-1',
      })
    })

    it('checkoutId가 없으면 order id를 tradeNo로 폴백', () => {
      mockValidateEvent.mockReturnValue({
        type: 'order.paid',
        data: {
          id: 'order-fallback',
          totalAmount: 299,
          status: 'paid',
          metadata: { authorId: 'author-1' },
        },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result?.tradeNo).toBe('order-fallback')
    })

    it('order.refunded 이벤트는 cancel 상태로 정규화한다', () => {
      mockValidateEvent.mockReturnValue({
        type: 'order.refunded',
        data: {
          id: 'order-2',
          checkoutId: 'checkout-xyz',
          totalAmount: 499,
          metadata: { authorId: 'author-2' },
        },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result?.status).toBe('cancel')
      expect(result?.tradeNo).toBe('checkout-xyz')
    })

    it('checkout.updated + succeeded 상태를 success로 정규화한다', () => {
      mockValidateEvent.mockReturnValue({
        type: 'checkout.updated',
        data: {
          id: 'checkout-s',
          status: 'succeeded',
          totalAmount: 99,
          metadata: { authorId: 'author-3' },
        },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result?.status).toBe('success')
      expect(result?.tradeNo).toBe('checkout-s')
    })

    it('checkout.updated + failed 상태를 fail로 정규화한다', () => {
      mockValidateEvent.mockReturnValue({
        type: 'checkout.updated',
        data: {
          id: 'checkout-f',
          status: 'failed',
          totalAmount: 0,
          metadata: { authorId: 'author-4' },
        },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result?.status).toBe('fail')
    })

    it('checkout.updated가 open/pending 상태면 null 반환 (무시)', () => {
      mockValidateEvent.mockReturnValue({
        type: 'checkout.updated',
        data: { id: 'checkout-o', status: 'open', metadata: {} },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result).toBeNull()
    })

    it('처리 대상이 아닌 이벤트(subscription.created 등)는 null 반환', () => {
      mockValidateEvent.mockReturnValue({
        type: 'subscription.created',
        data: {},
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result).toBeNull()
    })

    it('서명 검증 실패 시 null 반환 (WebhookVerificationError)', () => {
      // 런타임에 mock된 래퍼에서 WebhookVerificationError class를 가져옴
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { WebhookVerificationError } = require('./polar-webhooks')
      mockValidateEvent.mockImplementation(() => {
        throw new WebhookVerificationError('invalid signature')
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result).toBeNull()
    })

    it('기타 런타임 에러도 null 반환', () => {
      mockValidateEvent.mockImplementation(() => {
        throw new Error('unexpected parse error')
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result).toBeNull()
    })

    it('metadata의 authorId가 문자열이 아니면 undefined 반환', () => {
      mockValidateEvent.mockReturnValue({
        type: 'order.paid',
        data: {
          id: 'order-x',
          checkoutId: 'checkout-x',
          totalAmount: 99,
          status: 'paid',
          metadata: { authorId: 123 }, // 숫자 — 안전하게 무시
        },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result?.userId).toBeUndefined()
    })

    it('totalAmount가 없으면 netAmount → amount 순으로 폴백', () => {
      mockValidateEvent.mockReturnValue({
        type: 'order.paid',
        data: {
          id: 'order-y',
          checkoutId: 'checkout-y',
          netAmount: 250,
          status: 'paid',
          metadata: { authorId: 'author-y' },
        },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result?.amount).toBe(3500) // 250센트 → 고정 환율 폴백 (250/100 * 1400)
    })

    it('프로덕션 환경에서 webhook secret 미설정 시 null 반환', () => {
      delete process.env.POLAR_WEBHOOK_SECRET
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      const prodAdapter = new PolarAdapter()
      const result = prodAdapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result).toBeNull()

      process.env.NODE_ENV = originalEnv
    })
  })
})
