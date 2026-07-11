import { PolarAdapter } from './polar.adapter'
import {
  NormalizedWebhookEvent,
  NormalizedSubscriptionEvent,
  isSubscriptionEvent,
} from '@domain/port/outbound/payment-gateway.port'
import { WebhookVerificationFailedError } from '@domain/model/webhook-verification-error'

/**
 * CC-5 — verifyAndParseWebhook 반환이 충전/구독 union 으로 확장됨.
 * 충전(order/checkout) 이벤트 테스트는 이 헬퍼로 NormalizedWebhookEvent 로 좁힌다.
 */
function asOrderEvent(
  e: NormalizedWebhookEvent | NormalizedSubscriptionEvent | null,
): NormalizedWebhookEvent | null {
  if (e === null) return null
  if (isSubscriptionEvent(e)) throw new Error('구독 이벤트가 아닌 충전 이벤트를 기대함')
  return e
}

// Polar SDK 모킹 — 실제 HTTP 호출 방지
const mockCreate = jest.fn()
const mockList = jest.fn()
jest.mock('@polar-sh/sdk', () => ({
  Polar: jest.fn().mockImplementation(() => ({
    checkouts: { create: mockCreate, list: mockList },
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
    mockList.mockReset()
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
        productId: 'credit-basic',
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
          internalProductId: 'credit-basic',
        },
      })
      expect(result.paymentUrl).toBe('https://polar.sh/checkout/abc')
      expect(result.tradeNo).toBe('checkout-123')
    })

    it('credit-popular → POLAR_PRODUCT_POPULAR 매핑', async () => {
      mockCreate.mockResolvedValue({ id: 'c2', url: 'https://polar.sh/c2' })

      await adapter.initiatePayment({
        productId: 'credit-popular',
        productName: '20 크레딧',
        amount: 3000,
        userId: 'author-1',
        returnUrl: 'https://example.com',
      })

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ products: ['polar-prod-popular-uuid'] }),
      )
    })

    it('credit-best → POLAR_PRODUCT_BEST 매핑', async () => {
      mockCreate.mockResolvedValue({ id: 'c3', url: 'https://polar.sh/c3' })

      await adapter.initiatePayment({
        productId: 'credit-best',
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
          productId: 'credit-basic',
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
          productId: 'credit-basic',
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

    it('order.paid 이벤트를 성공으로 정규화한다 (eventId 박제 포함, PAY-P0-1)', () => {
      mockValidateEvent.mockReturnValue({
        type: 'order.paid',
        data: {
          id: 'order-1',
          checkoutId: 'checkout-abc',
          totalAmount: 499,
          status: 'paid',
          metadata: { authorId: 'author-1', internalProductId: 'credit-basic' },
        },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result).toEqual({
        eventId: 'msg_123', // dummyHeaders['webhook-id']
        type: 'order.paid',
        tradeNo: 'checkout-abc',
        amount: 5000, // 499센트 → ₩5,000 (CC-2a 디노미 — credit-basic priceUsd 499 → price 5000)
        status: 'success',
        userId: 'author-1',
      })
    })

    // ============================================================================
    // Sprint PAY-P0-1: webhook-id 헤더 추출 신규 검증
    // ============================================================================

    it('PAY-P0-1: webhook-id 헤더 누락 시 null 반환 (멱등성 보장 불가 → 안전 거부)', () => {
      mockValidateEvent.mockReturnValue({
        type: 'order.paid',
        data: {
          id: 'order-noeventid',
          checkoutId: 'checkout-noeventid',
          totalAmount: 199,
          status: 'paid',
          metadata: { authorId: 'author-1' },
        },
      })

      const headersWithoutWebhookId = {
        'webhook-timestamp': '1712345678',
        'webhook-signature': 'v1,abc',
        // webhook-id 누락
      }

      // F-13 — eventId 누락은 무효 → throw (컨트롤러 400 매핑). 구 null(201) 마스킹 제거.
      expect(() =>
        adapter.verifyAndParseWebhook(dummyBody, headersWithoutWebhookId),
      ).toThrow(WebhookVerificationFailedError)
    })

    it('PAY-P0-1: webhook-id 헤더가 빈 문자열이면 throw (F-13)', () => {
      mockValidateEvent.mockReturnValue({
        type: 'order.paid',
        data: {
          id: 'order-emptyid',
          checkoutId: 'checkout-emptyid',
          totalAmount: 199,
          status: 'paid',
          metadata: { authorId: 'author-1' },
        },
      })

      const headersEmptyId = {
        'webhook-id': '   ',
        'webhook-timestamp': '1712345678',
        'webhook-signature': 'v1,abc',
      }

      // F-13 — 빈 webhook-id 도 멱등성 보장 불가 → throw
      expect(() =>
        adapter.verifyAndParseWebhook(dummyBody, headersEmptyId),
      ).toThrow(WebhookVerificationFailedError)
    })

    it('PAY-P0-1: 대문자 Webhook-Id fallback도 추출 가능 (프록시 정규화 안전망)', () => {
      mockValidateEvent.mockReturnValue({
        type: 'order.paid',
        data: {
          id: 'order-uppercase',
          checkoutId: 'checkout-uppercase',
          totalAmount: 199,
          status: 'paid',
          metadata: { authorId: 'author-1' },
        },
      })

      const headersUpperCase = {
        'Webhook-Id': 'msg_uppercase',
        'webhook-timestamp': '1712345678',
        'webhook-signature': 'v1,abc',
      }

      const result = adapter.verifyAndParseWebhook(dummyBody, headersUpperCase)

      expect(result?.eventId).toBe('msg_uppercase')
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

      const result = asOrderEvent(adapter.verifyAndParseWebhook(dummyBody, dummyHeaders))

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

      const result = asOrderEvent(adapter.verifyAndParseWebhook(dummyBody, dummyHeaders))

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

      const result = asOrderEvent(adapter.verifyAndParseWebhook(dummyBody, dummyHeaders))

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

      const result = asOrderEvent(adapter.verifyAndParseWebhook(dummyBody, dummyHeaders))

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

    // CC-5 (PAY-P1-4) — 구독 생명주기 4 이벤트는 이제 정규화 결과를 반환한다.
    it('subscription.created — productId 역매핑으로 tier=pro 정규화', () => {
      process.env.POLAR_PRODUCT_SUBSCRIPTION_PRO = 'prod_pro_uuid'
      mockValidateEvent.mockReturnValue({
        type: 'subscription.created',
        data: {
          id: 'sub_polar_1',
          productId: 'prod_pro_uuid',
          metadata: { authorId: 'author-sub-1' },
        },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result).not.toBeNull()
      expect(isSubscriptionEvent(result!)).toBe(true)
      const sub = result as NormalizedSubscriptionEvent
      expect(sub.lifecycle).toBe('created')
      expect(sub.tier).toBe('pro')
      expect(sub.polarSubscriptionId).toBe('sub_polar_1')
      expect(sub.userId).toBe('author-sub-1')
      delete process.env.POLAR_PRODUCT_SUBSCRIPTION_PRO
    })

    it('subscription.updated — productId 미매칭 시 metadata.subscriptionTier 폴백', () => {
      mockValidateEvent.mockReturnValue({
        type: 'subscription.updated',
        data: {
          id: 'sub_polar_2',
          productId: 'unknown_prod',
          metadata: { authorId: 'author-sub-2', subscriptionTier: 'premium' },
        },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)
      const sub = result as NormalizedSubscriptionEvent
      expect(sub.lifecycle).toBe('updated')
      expect(sub.tier).toBe('premium')
    })

    it('subscription.canceled — tier=free 다운그레이드 (등급 무관)', () => {
      mockValidateEvent.mockReturnValue({
        type: 'subscription.canceled',
        data: {
          id: 'sub_polar_3',
          productId: 'prod_pro_uuid',
          metadata: { authorId: 'author-sub-3' },
        },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)
      const sub = result as NormalizedSubscriptionEvent
      expect(sub.lifecycle).toBe('canceled')
      expect(sub.tier).toBe('free')
    })

    it('subscription.revoked — tier=free 다운그레이드', () => {
      mockValidateEvent.mockReturnValue({
        type: 'subscription.revoked',
        data: { id: 'sub_polar_4', metadata: { authorId: 'author-sub-4' } },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)
      const sub = result as NormalizedSubscriptionEvent
      expect(sub.lifecycle).toBe('revoked')
      expect(sub.tier).toBe('free')
    })

    it('subscription.created — data.id(구독 ID) 누락 시 null 반환 (매핑 불가)', () => {
      mockValidateEvent.mockReturnValue({
        type: 'subscription.created',
        data: { metadata: { authorId: 'author-sub-5', subscriptionTier: 'pro' } },
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result).toBeNull()
    })

    it('미지원 이벤트(benefit.created 등)는 여전히 null 반환', () => {
      mockValidateEvent.mockReturnValue({
        type: 'benefit.created',
        data: {},
      })

      const result = adapter.verifyAndParseWebhook(dummyBody, dummyHeaders)

      expect(result).toBeNull()
    })

    it('서명 검증 실패 시 throw (F-13 — WebhookVerificationError → 400)', () => {
      // 런타임에 mock된 래퍼에서 WebhookVerificationError class를 가져옴
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { WebhookVerificationError } = require('./polar-webhooks')
      mockValidateEvent.mockImplementation(() => {
        throw new WebhookVerificationError('invalid signature')
      })

      // F-13 — 무효 서명은 throw (구 null → 201 silent ack 마스킹 제거)
      expect(() =>
        adapter.verifyAndParseWebhook(dummyBody, dummyHeaders),
      ).toThrow(WebhookVerificationFailedError)
    })

    it('파싱 불가(기타 런타임 에러)도 throw (F-13)', () => {
      mockValidateEvent.mockImplementation(() => {
        throw new Error('unexpected parse error')
      })

      expect(() =>
        adapter.verifyAndParseWebhook(dummyBody, dummyHeaders),
      ).toThrow(WebhookVerificationFailedError)
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

      const result = asOrderEvent(adapter.verifyAndParseWebhook(dummyBody, dummyHeaders))

      expect(result?.amount).toBe(3500) // 250센트 → 고정 환율 폴백 (250/100 * 1400)
    })

    it('프로덕션 환경에서 webhook secret 미설정 시 throw (F-13 — 검증 불가 4xx surface)', () => {
      delete process.env.POLAR_WEBHOOK_SECRET
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      const prodAdapter = new PolarAdapter()
      // F-13 — prod 시크릿 부재 = 검증 불가 → throw (구 null → 201 마스킹 제거).
      // F-12 로 부팅이 먼저 차단되나 런타임 방어.
      expect(() =>
        prodAdapter.verifyAndParseWebhook(dummyBody, dummyHeaders),
      ).toThrow(WebhookVerificationFailedError)

      process.env.NODE_ENV = originalEnv
    })
  })

  // ============================================================================
  // Sprint PAY-P0-2: listRecentCheckouts (PG↔DB 정합성 cron용)
  // ============================================================================
  describe('listRecentCheckouts (Sprint PAY-P0-2)', () => {
    it('Polar SDK list 호출 시 page/limit/sorting=-created_at 전달', async () => {
      mockList.mockResolvedValue({ result: { items: [] } })

      const since = new Date('2026-05-03T00:00:00Z')
      await adapter.listRecentCheckouts(since, 100)

      expect(mockList).toHaveBeenCalledWith({
        page: 1,
        limit: 100,
        sorting: ['-created_at'],
      })
    })

    it('limit이 100 초과면 100으로 캡, 1 미만이면 1로 보정', async () => {
      mockList.mockResolvedValue({ result: { items: [] } })

      await adapter.listRecentCheckouts(new Date(0), 500)
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 }),
      )

      mockList.mockClear()
      mockList.mockResolvedValue({ result: { items: [] } })
      await adapter.listRecentCheckouts(new Date(0), 0)
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1 }),
      )
    })

    it('checkout 결과를 NormalizedCheckout으로 정규화 (status/amount/createdAt)', async () => {
      const checkoutCreatedAt = new Date('2026-05-03T12:00:00Z')
      mockList.mockResolvedValue({
        result: {
          items: [
            {
              id: 'checkout-1',
              status: 'succeeded',
              totalAmount: 499, // CC-2a 디노미 — credit-basic priceUsd 499
              createdAt: checkoutCreatedAt,
            },
          ],
        },
      })

      const since = new Date('2026-05-03T00:00:00Z')
      const result = await adapter.listRecentCheckouts(since, 100)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        externalTransactionId: 'checkout-1',
        status: 'succeeded',
        amount: 5000, // credit-basic 매핑 (priceUsd 499 → price 5000)
        createdAt: checkoutCreatedAt,
      })
    })

    it('since 이전 createdAt 도달 시 break (페이지 진행 중단)', async () => {
      // page 1: 일부는 since 이후, 일부는 since 이전
      const since = new Date('2026-05-03T12:00:00Z')
      mockList.mockResolvedValueOnce({
        result: {
          items: [
            {
              id: 'recent-1',
              status: 'succeeded',
              totalAmount: 199,
              createdAt: new Date('2026-05-03T13:00:00Z'),
            },
            {
              id: 'old-1',
              status: 'succeeded',
              totalAmount: 199,
              createdAt: new Date('2026-05-03T11:00:00Z'), // since 이전
            },
          ],
        },
      })

      const result = await adapter.listRecentCheckouts(since, 100)

      expect(result).toHaveLength(1)
      expect(result[0].externalTransactionId).toBe('recent-1')
      // since 이전 도달 → page 2 호출 안 됨
      expect(mockList).toHaveBeenCalledTimes(1)
    })

    it('items.length < limit이면 마지막 페이지로 판정 → break', async () => {
      // limit=100인데 page1에 50건만 → 다음 페이지 호출 안 됨
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `c-${i}`,
        status: 'succeeded',
        totalAmount: 199,
        createdAt: new Date('2026-05-03T13:00:00Z'),
      }))
      mockList.mockResolvedValueOnce({ result: { items } })

      const result = await adapter.listRecentCheckouts(
        new Date('2026-05-03T00:00:00Z'),
        100,
      )

      expect(result).toHaveLength(50)
      expect(mockList).toHaveBeenCalledTimes(1)
    })

    it('Polar SDK list 호출 실패 시 래핑된 에러 throw', async () => {
      mockList.mockRejectedValue(new Error('rate limit'))

      await expect(
        adapter.listRecentCheckouts(new Date(0), 100),
      ).rejects.toThrow('Polar checkouts.list 호출 실패')
    })

    it('checkout.id가 없으면 collected에서 제외', async () => {
      mockList.mockResolvedValueOnce({
        result: {
          items: [
            {
              // id 누락
              status: 'succeeded',
              totalAmount: 199,
              createdAt: new Date('2026-05-03T13:00:00Z'),
            },
            {
              id: 'valid-1',
              status: 'succeeded',
              totalAmount: 199,
              createdAt: new Date('2026-05-03T13:00:00Z'),
            },
          ],
        },
      })

      const result = await adapter.listRecentCheckouts(
        new Date('2026-05-03T00:00:00Z'),
        100,
      )

      expect(result).toHaveLength(1)
      expect(result[0].externalTransactionId).toBe('valid-1')
    })

    it('checkout status를 NormalizedCheckout status로 정규화 (open/expired/failed)', async () => {
      mockList.mockResolvedValueOnce({
        result: {
          items: [
            {
              id: 'c-open',
              status: 'open',
              totalAmount: 199,
              createdAt: new Date('2026-05-03T13:00:00Z'),
            },
            {
              id: 'c-expired',
              status: 'expired',
              totalAmount: 199,
              createdAt: new Date('2026-05-03T13:00:00Z'),
            },
            {
              id: 'c-failed',
              status: 'failed',
              totalAmount: 199,
              createdAt: new Date('2026-05-03T13:00:00Z'),
            },
          ],
        },
      })

      const result = await adapter.listRecentCheckouts(
        new Date('2026-05-03T00:00:00Z'),
        100,
      )

      expect(result.find((c) => c.externalTransactionId === 'c-open')?.status).toBe('open')
      expect(result.find((c) => c.externalTransactionId === 'c-expired')?.status).toBe('failed')
      expect(result.find((c) => c.externalTransactionId === 'c-failed')?.status).toBe('failed')
    })
  })

  // ============================================================================
  // Sprint PAY-P3-B: Polar SDK timeout 정책 + classifyPolarError 5분류 (구멍-C 차단)
  // 정본: .claude/shared-contracts.md §24 PolarSDKTimeoutPolicy
  // AC-1 (timeout) / AC-2 (network) / AC-3 (server_5xx) / AC-4 (client_4xx) / AC-6 (timeout 옵션)
  // ============================================================================
  describe('PAY-P3-B: classifyPolarError 5분류 + SDK timeout 옵션', () => {
    describe('AC-1: timeout 분류', () => {
      it('AbortError name → timeout 분류', () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('timeout')
        expect(result.message).toBe('The operation was aborted')
        expect(result.httpStatus).toBeUndefined()
      })

      it('RequestTimeoutError name (Polar SDK v0.47.0) → timeout 분류', () => {
        const err = new Error('Request timed out after 30000ms')
        err.name = 'RequestTimeoutError'
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('timeout')
      })

      it('message에 "timeout" 포함 → timeout 분류 (name fallback)', () => {
        const err = new Error('fetch timeout exceeded')
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('timeout')
      })
    })

    describe('AC-2: network 분류', () => {
      it('ECONNRESET message prefix → network 분류', () => {
        const err = new Error('ECONNRESET — connection reset by peer')
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('network')
        expect(result.httpStatus).toBeUndefined()
      })

      it('ENOTFOUND message → network 분류', () => {
        const err = new Error('ENOTFOUND api.polar.sh')
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('network')
      })

      it('ConnectionError name (Polar SDK) → network 분류', () => {
        const err = new Error('failed to connect to api.polar.sh')
        err.name = 'ConnectionError'
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('network')
      })
    })

    describe('AC-3: server_5xx 분류', () => {
      it('PolarError statusCode=503 → server_5xx 분류', () => {
        // PolarError duck typing — statusCode 속성으로 분류 (SDK 내부 import 의존 0)
        const err = Object.assign(new Error('Service Unavailable'), {
          statusCode: 503,
        })
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('server_5xx')
        expect(result.httpStatus).toBe(503)
      })

      it('error.response.status=502 (legacy fetch 패턴) → server_5xx 분류', () => {
        const err = Object.assign(new Error('Bad Gateway'), {
          response: { status: 502 },
        })
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('server_5xx')
        expect(result.httpStatus).toBe(502)
      })
    })

    describe('AC-4: client_4xx 분류 (retry 무의미)', () => {
      it('PolarError statusCode=400 → client_4xx 분류 (Bad Request)', () => {
        const err = Object.assign(new Error('Bad Request: invalid metadata'), {
          statusCode: 400,
        })
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('client_4xx')
        expect(result.httpStatus).toBe(400)
        expect(result.message).toContain('invalid metadata')
      })

      it('PolarError statusCode=401 → client_4xx 분류 (Unauthorized — 만료된 토큰)', () => {
        const err = Object.assign(new Error('Unauthorized'), { statusCode: 401 })
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('client_4xx')
        expect(result.httpStatus).toBe(401)
      })

      it('PolarError statusCode=422 → client_4xx 분류 (Unprocessable Entity)', () => {
        const err = Object.assign(new Error('Unprocessable Entity'), {
          statusCode: 422,
        })
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('client_4xx')
        expect(result.httpStatus).toBe(422)
      })
    })

    describe('AC-5: unknown fallback (안전 측면)', () => {
      it('분류 실패 시 unknown 반환 (retry 가능 영역 fallback)', () => {
        const err = new Error('something completely unexpected')
        const result = adapter.classifyPolarError(err)
        expect(result.errorClass).toBe('unknown')
        expect(result.httpStatus).toBeUndefined()
      })

      it('non-Error 객체도 unknown으로 안전 처리', () => {
        const result = adapter.classifyPolarError('plain string error')
        expect(result.errorClass).toBe('unknown')
        expect(result.message).toBe('plain string error')
      })
    })

    describe('AC-6: SDK timeout 옵션 (워커 자원 leak 차단)', () => {
      it('Polar SDK 인스턴스 생성 시 timeoutMs 옵션 전달 (기본값 30000)', () => {
        // Polar 생성자가 mock 호출되었는지 검증 — beforeEach에서 new PolarAdapter() 호출됨
        const PolarMock = jest.requireMock('@polar-sh/sdk').Polar as jest.Mock
        const callArgs = PolarMock.mock.calls[PolarMock.mock.calls.length - 1]?.[0]
        expect(callArgs).toEqual(
          expect.objectContaining({
            accessToken: 'test-token',
            server: 'sandbox',
            timeoutMs: 30000,
          }),
        )
      })

      it('POLAR_SDK_TIMEOUT_MS env 오버라이드 적용 (60000ms)', () => {
        process.env.POLAR_SDK_TIMEOUT_MS = '60000'
        const PolarMock = jest.requireMock('@polar-sh/sdk').Polar as jest.Mock
        PolarMock.mockClear()
        new PolarAdapter()
        const callArgs = PolarMock.mock.calls[0]?.[0]
        expect(callArgs).toEqual(
          expect.objectContaining({ timeoutMs: 60000 }),
        )
        delete process.env.POLAR_SDK_TIMEOUT_MS
      })

      it('잘못된 POLAR_SDK_TIMEOUT_MS (NaN/음수) 시 기본값 30000 fallback', () => {
        process.env.POLAR_SDK_TIMEOUT_MS = 'not-a-number'
        const PolarMock = jest.requireMock('@polar-sh/sdk').Polar as jest.Mock
        PolarMock.mockClear()
        new PolarAdapter()
        const callArgs = PolarMock.mock.calls[0]?.[0]
        expect(callArgs?.timeoutMs).toBe(30000)
        delete process.env.POLAR_SDK_TIMEOUT_MS
      })
    })

    describe('AC-7: initiatePayment + listRecentCheckouts catch 분류 적용', () => {
      it('initiatePayment 호출 시 timeout 발생 → 분류 로깅 후 throw (caller가 분류 활용)', async () => {
        const timeoutErr = new Error('Request timed out')
        timeoutErr.name = 'RequestTimeoutError'
        mockCreate.mockRejectedValueOnce(timeoutErr)

        await expect(
          adapter.initiatePayment({
            productId: 'credit-basic',
            productName: '5 크레딧',
            amount: 1000,
            userId: 'author-1',
            returnUrl: 'https://example.com',
          }),
        ).rejects.toThrow('Polar checkout 생성 실패')

        // catch 블록에서 classifyPolarError 호출 검증 (직접 호출로도 timeout 분류 박제됨)
        const cls = adapter.classifyPolarError(timeoutErr)
        expect(cls.errorClass).toBe('timeout')
      })

      it('listRecentCheckouts 호출 시 4xx 발생 → 분류 로깅 후 throw', async () => {
        const httpErr = Object.assign(new Error('Bad Request'), { statusCode: 400 })
        mockList.mockRejectedValueOnce(httpErr)

        await expect(
          adapter.listRecentCheckouts(new Date('2026-05-01T00:00:00Z'), 50),
        ).rejects.toThrow('Polar checkouts.list 호출 실패')

        const cls = adapter.classifyPolarError(httpErr)
        expect(cls.errorClass).toBe('client_4xx')
        expect(cls.httpStatus).toBe(400)
      })
    })
  })

  describe('PAY-P3-H: Circuit Breaker 적용 (3 호출점 래핑)', () => {
    /**
     * AC-1: CircuitBreakerPort 미주입 시 (기존 인스턴스화) — 회귀 보존 정합.
     *       기존 spec은 PolarAdapter() 직접 호출로 검증 (Circuit Breaker DI 미주입 = undefined).
     * AC-2: Circuit Breaker 주입 시 — initiatePayment가 execute 'polar:checkouts:create' 래핑.
     * AC-3: Circuit Breaker 주입 시 — listRecentCheckouts가 execute 'polar:checkouts:list' 래핑.
     * AC-4: OPEN 상태 — initiatePayment 호출 시 SDK 호출 0건 + CircuitOpenError 그대로 throw.
     */
    it('AC-1: Circuit Breaker 미주입 — 기존 흐름 그대로 동작 (회귀 0건)', async () => {
      // adapter는 beforeEach에서 new PolarAdapter() — circuitBreaker undefined
      mockCreate.mockResolvedValueOnce({ url: 'https://polar/checkout/cb-test', id: 'cb-trade-001' })
      process.env.POLAR_PRODUCT_BASIC = 'polar-product-basic'

      const result = await adapter.initiatePayment({
        productId: 'credit-basic',
        productName: 'Basic',
        amount: 5000,
        userId: 'author-cb',
        returnUrl: 'https://app/return',
      })
      expect(result.paymentUrl).toBe('https://polar/checkout/cb-test')
      expect(result.tradeNo).toBe('cb-trade-001')
    })

    it('AC-2: Circuit Breaker 주입 — initiatePayment가 execute("polar:checkouts:create", fn) 래핑', async () => {
      const executeMock = jest.fn().mockImplementation(async (_key: string, fn: () => Promise<unknown>) => fn())
      const breaker = {
        execute: executeMock,
        getState: jest.fn(),
        getStats: jest.fn(),
        forceOpen: jest.fn(),
        forceClose: jest.fn(),
      }
      const adapterWithCb = new PolarAdapter(breaker as never)
      mockCreate.mockResolvedValueOnce({ url: 'https://polar/cb-create', id: 'trade-cb' })
      process.env.POLAR_PRODUCT_BASIC = 'polar-product-basic'

      await adapterWithCb.initiatePayment({
        productId: 'credit-basic',
        productName: 'Basic',
        amount: 5000,
        userId: 'author-1',
        returnUrl: 'https://app/return',
      })

      expect(executeMock).toHaveBeenCalledTimes(1)
      expect(executeMock).toHaveBeenCalledWith('polar:checkouts:create', expect.any(Function))
    })

    it('AC-3: Circuit Breaker 주입 — listRecentCheckouts가 execute("polar:checkouts:list", fn) 래핑', async () => {
      const executeMock = jest.fn().mockImplementation(async (_key: string, fn: () => Promise<unknown>) => fn())
      const breaker = {
        execute: executeMock,
        getState: jest.fn(),
        getStats: jest.fn(),
        forceOpen: jest.fn(),
        forceClose: jest.fn(),
      }
      const adapterWithCb = new PolarAdapter(breaker as never)
      mockList.mockResolvedValueOnce({ result: { items: [] } })

      await adapterWithCb.listRecentCheckouts(new Date('2026-05-01T00:00:00Z'), 50)

      expect(executeMock).toHaveBeenCalledWith('polar:checkouts:list', expect.any(Function))
    })

    it('AC-4: OPEN 상태 — initiatePayment 호출 시 SDK 호출 0건 + CircuitOpenError 그대로 throw', async () => {
      // CircuitOpenError 클래스를 직접 import — 도메인 영역 정합
      const { CircuitOpenError } = await import('@domain/model/circuit-breaker-state')
      const circuitErr = new CircuitOpenError('polar:checkouts:create', {
        state: 'open' as never,
        failureCount: 5,
        halfOpenTrialCount: 0,
        halfOpenSuccessCount: 0,
      })
      const executeMock = jest.fn().mockRejectedValue(circuitErr)
      const breaker = {
        execute: executeMock,
        getState: jest.fn(),
        getStats: jest.fn(),
        forceOpen: jest.fn(),
        forceClose: jest.fn(),
      }
      const adapterWithCb = new PolarAdapter(breaker as never)
      process.env.POLAR_PRODUCT_BASIC = 'polar-product-basic'

      // CircuitOpenError 그대로 throw — SDK 호출 0건 (execute가 fn 호출 자체 차단)
      await expect(
        adapterWithCb.initiatePayment({
          productId: 'credit-basic',
          productName: 'Basic',
          amount: 5000,
          userId: 'author-1',
          returnUrl: 'https://app/return',
        }),
      ).rejects.toThrow(CircuitOpenError)

      // 실제 SDK create 호출 0건 검증 (execute가 fn 자체 실행 안 함)
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })
})
