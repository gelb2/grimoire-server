import { ServiceUnavailableException, BadRequestException } from '@nestjs/common'
import { SubscriptionController } from './subscription.controller'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

/**
 * 크레딧 개편 CC-5 (2026-05-22, PAY-P1-4) — 구독 컨트롤러 spec.
 *
 * 검증 — POST /subscriptions/checkout(Guard/Throttle/503 graceful) + GET /membership(Guard/내부 ID 미노출).
 */
describe('SubscriptionController', () => {
  let controller: SubscriptionController
  let mockStartSubscription: any
  let mockGetMembership: any

  const authReq = { user: { sub: 'author-1', slug: 'deer', email: 'a@a.com' } } as any

  beforeEach(() => {
    mockStartSubscription = {
      execute: jest.fn().mockResolvedValue({
        paymentUrl: 'https://polar.sh/checkout/abc',
        tradeNo: 'checkout_abc',
      }),
    }
    mockGetMembership = {
      execute: jest.fn().mockResolvedValue({
        tier: 'pro',
        monthlyPoolPoints: 93000,
        poolBalance: 50000,
        poolResetAt: new Date('2026-06-01T00:00:00Z'),
        status: 'active',
        expiresAt: new Date('2026-06-01T00:00:00Z'),
      }),
    }
    controller = new SubscriptionController(
      mockStartSubscription as any,
      mockGetMembership as any,
    )
  })

  describe('POST /subscriptions/checkout', () => {
    it('본인(req.user.sub) 구독으로 checkout 을 시작한다', async () => {
      const res = await controller.checkout(authReq, {
        tier: 'pro',
        returnUrl: 'https://grimoire-book.com/done',
      })
      // 소유권 — body 에 authorId 미수신, req.user.sub 로 호출 (위조 불가)
      expect(mockStartSubscription.execute).toHaveBeenCalledWith(
        'author-1', 'pro', 'https://grimoire-book.com/done',
      )
      expect(res.paymentUrl).toBe('https://polar.sh/checkout/abc')
      expect(res.tradeNo).toBe('checkout_abc')
    })

    it('graceful — env 미설정 시 usecase 503 을 그대로 전파한다', async () => {
      mockStartSubscription.execute.mockRejectedValue(
        new ServiceUnavailableException('구독 결제가 아직 활성화되지 않았습니다. 잠시 후 다시 시도해 주세요.'),
      )
      await expect(
        controller.checkout(authReq, { tier: 'pro', returnUrl: 'https://x.com' }),
      ).rejects.toThrow(ServiceUnavailableException)
    })

    it('잘못된 tier 는 usecase BadRequestException 전파', async () => {
      mockStartSubscription.execute.mockRejectedValue(new BadRequestException('bad tier'))
      await expect(
        controller.checkout(authReq, { tier: 'free' as any, returnUrl: 'https://x.com' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('JwtAuthGuard 가 적용돼 있다 (인증 필수)', () => {
      const guards = Reflect.getMetadata('__guards__', controller.checkout) ?? []
      expect(guards).toContain(JwtAuthGuard)
    })

    it('@Throttle 분당 3회 rate limit 이 적용돼 있다', () => {
      // @Throttle 메타데이터 — default tracker limit (THROTTLER:LIMITdefault)
      const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', controller.checkout)
      expect(limit).toBeDefined()
    })
  })

  describe('GET /membership', () => {
    it('본인 멤버십 등급/풀을 반환한다', async () => {
      const res = await controller.getMembership(authReq)
      expect(mockGetMembership.execute).toHaveBeenCalledWith('author-1')
      expect(res.tier).toBe('pro')
      expect(res.monthlyPoolPoints).toBe(93000)
      expect(res.poolBalance).toBe(50000)
      expect(res.status).toBe('active')
      // 날짜는 ISO 문자열로 직렬화
      expect(res.poolResetAt).toBe('2026-06-01T00:00:00.000Z')
    })

    it('내부 ID(authorId/polarSubscriptionId)를 응답에 노출하지 않는다 (SECURITY.md §4)', async () => {
      const res = await controller.getMembership(authReq)
      expect(res).not.toHaveProperty('authorId')
      expect(res).not.toHaveProperty('polarSubscriptionId')
      expect(res).not.toHaveProperty('id')
    })

    it('JwtAuthGuard 가 적용돼 있다 (인증 필수)', () => {
      const guards = Reflect.getMetadata('__guards__', controller.getMembership) ?? []
      expect(guards).toContain(JwtAuthGuard)
    })
  })
})
