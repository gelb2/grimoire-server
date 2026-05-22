import { ProcessSubscriptionWebhookUseCase } from './process-subscription-webhook.usecase'
import type { NormalizedSubscriptionEvent } from '@domain/port/outbound/payment-gateway.port'

/**
 * 크레딧 개편 CC-5 (2026-05-22, PAY-P1-4) — 구독 webhook usecase 단위 spec.
 *
 * 검증 — 4 이벤트별 changeTier 호출 + 멱등성 + polarSubscriptionId 매핑 저장.
 * 실 DB / 외부 API 미사용 (CLAUDE.md §4-8).
 */
describe('ProcessSubscriptionWebhookUseCase', () => {
  let useCase: ProcessSubscriptionWebhookUseCase
  let mockMembershipRepo: any
  let mockWebhookEventRepo: any

  /** 구독 webhook 이벤트 mock 생성 헬퍼 */
  const subEvent = (
    lifecycle: 'created' | 'updated' | 'canceled' | 'revoked',
    tier: 'free' | 'pro' | 'premium',
    overrides: Partial<NormalizedSubscriptionEvent> = {},
  ): NormalizedSubscriptionEvent => ({
    eventId: `evt_${lifecycle}_1`,
    type: `subscription.${lifecycle}`,
    lifecycle,
    polarSubscriptionId: 'sub_polar_1',
    tier,
    userId: 'author-1',
    ...overrides,
  })

  beforeEach(() => {
    mockMembershipRepo = {
      changeTier: jest.fn().mockResolvedValue({
        id: 'plan-1', authorId: 'author-1', tier: 'pro',
        monthlyPoolPoints: 93000, poolBalance: 93000, poolResetAt: new Date('2099-01-01'),
        startedAt: new Date('2026-01-01'), expiresAt: new Date('2099-01-01'),
        polarSubscriptionId: 'sub_polar_1', status: 'active',
      }),
    }
    mockWebhookEventRepo = {
      findByEventId: jest.fn().mockResolvedValue(null),
      createIfAbsent: jest.fn().mockResolvedValue({ id: 'we-1' }),
      markStatus: jest.fn().mockResolvedValue(undefined),
    }
    useCase = new ProcessSubscriptionWebhookUseCase(mockMembershipRepo, mockWebhookEventRepo)
  })

  describe('등급 변경 — changeTier 연동', () => {
    it('subscription.created → changeTier(authorId, pro, _, polarSubscriptionId)', async () => {
      const result = await useCase.execute(subEvent('created', 'pro'))
      expect(result.processed).toBe(true)
      expect(result.tier).toBe('pro')
      expect(mockMembershipRepo.changeTier).toHaveBeenCalledWith(
        'author-1', 'pro', expect.any(Date), 'sub_polar_1',
      )
    })

    it('subscription.updated → changeTier 로 등급 변경 (premium)', async () => {
      const result = await useCase.execute(subEvent('updated', 'premium'))
      expect(result.processed).toBe(true)
      expect(mockMembershipRepo.changeTier).toHaveBeenCalledWith(
        'author-1', 'premium', expect.any(Date), 'sub_polar_1',
      )
    })

    it('subscription.canceled → changeTier(authorId, free) 다운그레이드', async () => {
      const result = await useCase.execute(subEvent('canceled', 'free'))
      expect(result.processed).toBe(true)
      expect(mockMembershipRepo.changeTier).toHaveBeenCalledWith(
        'author-1', 'free', expect.any(Date), 'sub_polar_1',
      )
    })

    it('subscription.revoked → changeTier(authorId, free) 다운그레이드', async () => {
      const result = await useCase.execute(subEvent('revoked', 'free'))
      expect(result.processed).toBe(true)
      expect(mockMembershipRepo.changeTier).toHaveBeenCalledWith(
        'author-1', 'free', expect.any(Date), 'sub_polar_1',
      )
    })
  })

  describe('멱등성 게이트 — WebhookEvent 재사용', () => {
    it('이미 처리된 eventId 면 changeTier 0회 + skip', async () => {
      mockWebhookEventRepo.findByEventId.mockResolvedValue({
        id: 'we-1', eventId: 'evt_created_1', source: 'polar',
        eventType: 'subscription.created', status: 'processed', processedAt: new Date(),
      })
      const result = await useCase.execute(subEvent('created', 'pro'))
      expect(result.processed).toBe(false)
      expect(result.reason).toBe('duplicate_event')
      expect(mockMembershipRepo.changeTier).not.toHaveBeenCalled()
    })

    it('처리 성공 시 WebhookEvent status=processed 박제', async () => {
      await useCase.execute(subEvent('created', 'pro'))
      expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt_created_1', status: 'processed' }),
      )
    })
  })

  describe('방어 — userId 누락 / changeTier 실패', () => {
    it('userId 누락 시 changeTier 0회 + skip(missing_user_id)', async () => {
      const result = await useCase.execute(
        subEvent('created', 'pro', { userId: undefined }),
      )
      expect(result.processed).toBe(false)
      expect(result.reason).toBe('missing_user_id')
      expect(mockMembershipRepo.changeTier).not.toHaveBeenCalled()
    })

    it('changeTier 실패 시 WebhookEvent status=failed 박제 후 throw', async () => {
      mockMembershipRepo.changeTier.mockRejectedValue(new Error('DB 장애'))
      await expect(useCase.execute(subEvent('created', 'pro'))).rejects.toThrow('DB 장애')
      expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      )
    })
  })
})
