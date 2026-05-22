/**
 * 크레딧 개편 CC-5 (2026-05-22, PAY-P1-4) — 구독 정기결제 연동 통합 spec.
 *
 * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §7(PAY-P1-4) + §5-A(HIGH-1 案 B)
 *       .claude/state/sprint-cc5-subscription-plan-draft.md §7 (C7f/C7g/C7h)
 *
 * ── 본 spec 의 존재 이유 ──
 *  unit PASS 여도 "구독 webhook → changeTier → MembershipPlan 갱신 → getPlan 반영 →
 *  theme-slot 새 tier 따름" 사슬은 unit mock 으로 보이지 않는다 (CC-1~CC-3 통합 spec 철학 정합).
 *  실 `ProcessSubscriptionWebhookUseCase`/`GetMembershipUseCase`/`StartSubscriptionUseCase`/
 *  `ThemeSlotUseCase` + 인메모리 fake 로 통합 증명.
 *
 *  핵심 케이스:
 *   ① subscription.created webhook → changeTier → MembershipPlan.tier='pro' + polarSubscriptionId 저장
 *   ② GET /membership(getMembership)이 갱신 tier 반환
 *   ③ subscription.revoked → changeTier(_, 'free') → getPlan tier='free'
 *   ④ 案 B 정합 — 구독 webhook 후 theme-slot getSlotInfo 가 새 tier 슬롯 한도 반환
 *   ⑤ graceful — env 미설정 시 POST /subscriptions/checkout 503 + getMembership·webhook 정상
 *   ⑥ 멱등성 — 동일 구독 webhook 2회 → changeTier 1회만
 *
 *  실 DB / 외부 API 미사용 (CLAUDE.md §4-8).
 */
import { ProcessSubscriptionWebhookUseCase } from './process-subscription-webhook.usecase'
import { GetMembershipUseCase } from './get-membership.usecase'
import { StartSubscriptionUseCase } from './start-subscription.usecase'
import { ThemeSlotUseCase } from '@application/theme/theme-slot.usecase'
import { ServiceUnavailableException } from '@nestjs/common'
import type {
  MembershipPlanPort,
  MembershipPlanState,
  LazyResetResult,
} from '@domain/port/outbound/membership-plan.port'
import type {
  WebhookEventRepositoryPort,
  WebhookEventRecord,
  WebhookEventCreateInput,
} from '@domain/port/outbound/webhook-event-repository.port'
import type {
  PaymentGatewayPort,
  NormalizedWebhookEvent,
  NormalizedSubscriptionEvent,
  NormalizedCheckout,
  PaymentInitRequest,
  PaymentInitResponse,
} from '@domain/port/outbound/payment-gateway.port'
import { monthlyPoolFor } from '@domain/model/membership-tier'

// ─────────────────────────────────────────────────────────
// 인메모리 fake
// ─────────────────────────────────────────────────────────

function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0))
}

/** Fake MembershipPlanPort — 실 `prisma-membership-plan.repository` changeTier 로직 미러. */
class FakeMembershipPlanPort implements MembershipPlanPort {
  private readonly plans = new Map<string, MembershipPlanState>()
  changeTierCalls = 0

  seed(plan: MembershipPlanState) {
    this.plans.set(plan.authorId, plan)
  }

  async getPlan(authorId: string): Promise<MembershipPlanState | null> {
    return this.plans.get(authorId) ?? null
  }

  async resetMonthlyPool(authorId: string, now: Date): Promise<void> {
    const plan = this.plans.get(authorId)
    if (!plan) throw new Error('활성 멤버십을 찾을 수 없습니다')
    const newPool = monthlyPoolFor(plan.tier)
    this.plans.set(authorId, {
      ...plan,
      monthlyPoolPoints: newPool,
      poolBalance: newPool,
      poolResetAt: nextMonthStart(now),
    })
  }

  async findPlansToReset(): Promise<MembershipPlanState[]> {
    return []
  }

  async changeTier(
    authorId: string,
    tier: 'free' | 'pro' | 'premium',
    now: Date,
    polarSubscriptionId?: string,
  ): Promise<MembershipPlanState> {
    this.changeTierCalls += 1
    const newPool = monthlyPoolFor(tier)
    const nextReset = nextMonthStart(now)
    const existing = this.plans.get(authorId)
    const status: 'active' | 'cancelled' = tier === 'free' ? 'cancelled' : 'active'
    const updated: MembershipPlanState = {
      id: existing?.id ?? `plan-${authorId}`,
      authorId,
      tier,
      monthlyPoolPoints: newPool,
      poolBalance: newPool,
      poolResetAt: nextReset,
      startedAt: existing?.startedAt ?? now,
      expiresAt: tier === 'free' ? now : nextReset,
      polarSubscriptionId:
        polarSubscriptionId !== undefined
          ? polarSubscriptionId
          : (existing?.polarSubscriptionId ?? null),
      status,
    }
    this.plans.set(authorId, updated)
    return updated
  }

  async checkAndResetExpiredPool(authorId: string, now: Date): Promise<LazyResetResult> {
    const plan = this.plans.get(authorId)
    if (!plan) return { reset: false, plan: null }
    if (plan.tier === 'free' || plan.status !== 'active') return { reset: false, plan }
    if (plan.poolResetAt.getTime() > now.getTime()) return { reset: false, plan }
    await this.resetMonthlyPool(authorId, now)
    return { reset: true, plan: this.plans.get(authorId)! }
  }
}

/** Fake WebhookEventRepositoryPort — eventId @unique 멱등성 미러. */
class FakeWebhookEventRepo implements WebhookEventRepositoryPort {
  private readonly events = new Map<string, WebhookEventRecord>()

  async findByEventId(eventId: string): Promise<WebhookEventRecord | null> {
    return this.events.get(eventId) ?? null
  }

  async createIfAbsent(input: WebhookEventCreateInput): Promise<WebhookEventRecord | null> {
    if (this.events.has(input.eventId)) return null
    const record: WebhookEventRecord = {
      id: `we-${this.events.size + 1}`,
      eventId: input.eventId,
      source: input.source,
      eventType: input.eventType,
      status: input.status ?? 'processed',
      processedAt: new Date(),
    }
    this.events.set(input.eventId, record)
    return record
  }

  async markStatus(): Promise<void> {
    /* no-op */
  }
}

/** Fake PaymentGatewayPort — initiateSubscriptionCheckout 만 사용 (env 토글). */
class FakePaymentGateway implements PaymentGatewayPort {
  constructor(private readonly subscriptionEnvSet: boolean) {}

  async initiatePayment(_r: PaymentInitRequest): Promise<PaymentInitResponse> {
    return { paymentUrl: 'https://polar.sh/c/x', tradeNo: 'tx' }
  }
  verifyAndParseWebhook(): NormalizedWebhookEvent | NormalizedSubscriptionEvent | null {
    return null
  }
  async listRecentCheckouts(): Promise<NormalizedCheckout[]> {
    return []
  }
  // graceful §4 — env 미설정 시 null 반환 (실 어댑터 resolveSubscriptionProductId 미러).
  async initiateSubscriptionCheckout(
    tier: 'pro' | 'premium',
    userId: string,
    returnUrl: string,
  ): Promise<PaymentInitResponse | null> {
    if (!this.subscriptionEnvSet) return null
    return {
      paymentUrl: `https://polar.sh/subscribe/${tier}?u=${userId}&r=${encodeURIComponent(returnUrl)}`,
      tradeNo: `sub_checkout_${tier}`,
    }
  }
}

/** 구독 webhook 이벤트 생성 헬퍼 */
function subEvent(
  lifecycle: 'created' | 'updated' | 'canceled' | 'revoked',
  tier: 'free' | 'pro' | 'premium',
  eventId: string,
): NormalizedSubscriptionEvent {
  return {
    eventId,
    type: `subscription.${lifecycle}`,
    lifecycle,
    polarSubscriptionId: 'sub_polar_int_1',
    tier,
    userId: 'author-1',
  }
}

// ─────────────────────────────────────────────────────────
// 통합 테스트
// ─────────────────────────────────────────────────────────

describe('CC-5 구독 정기결제 연동 통합 — webhook → changeTier → MembershipPlan', () => {
  let membershipPort: FakeMembershipPlanPort
  let webhookRepo: FakeWebhookEventRepo
  let subscriptionWebhook: ProcessSubscriptionWebhookUseCase
  let getMembership: GetMembershipUseCase

  beforeEach(() => {
    membershipPort = new FakeMembershipPlanPort()
    webhookRepo = new FakeWebhookEventRepo()
    subscriptionWebhook = new ProcessSubscriptionWebhookUseCase(membershipPort, webhookRepo)
    getMembership = new GetMembershipUseCase(membershipPort)
  })

  it('① subscription.created → changeTier → MembershipPlan.tier=pro + polarSubscriptionId 저장', async () => {
    const result = await subscriptionWebhook.execute(subEvent('created', 'pro', 'evt_1'))

    expect(result.processed).toBe(true)
    const plan = await membershipPort.getPlan('author-1')
    expect(plan?.tier).toBe('pro')
    expect(plan?.status).toBe('active')
    expect(plan?.polarSubscriptionId).toBe('sub_polar_int_1')
    expect(plan?.monthlyPoolPoints).toBe(93000)
  })

  it('② GET /membership(getMembership)이 갱신된 tier 를 반환', async () => {
    await subscriptionWebhook.execute(subEvent('created', 'premium', 'evt_2'))

    const membership = await getMembership.execute('author-1')
    expect(membership.tier).toBe('premium')
    expect(membership.monthlyPoolPoints).toBe(191500)
    expect(membership.status).toBe('active')
  })

  it('③ subscription.revoked → changeTier(_, free) → getPlan tier=free 다운그레이드', async () => {
    // 먼저 pro 구독 → 이후 revoke
    await subscriptionWebhook.execute(subEvent('created', 'pro', 'evt_3a'))
    const afterCreate = await getMembership.execute('author-1')
    expect(afterCreate.tier).toBe('pro')

    await subscriptionWebhook.execute(subEvent('revoked', 'free', 'evt_3b'))
    const afterRevoke = await getMembership.execute('author-1')
    expect(afterRevoke.tier).toBe('free')
    expect(afterRevoke.status).toBe('cancelled')
  })

  it('④ 案 B 정합 — 구독 webhook 후 theme-slot getSlotInfo 가 새 tier 슬롯 한도 반환', async () => {
    // 案 B — theme-slot 이 MembershipPlanPort.getPlan 으로 tier 정본 조회.
    const mockThemeRepo = {
      findAllByAuthorId: jest.fn().mockResolvedValue([]),
    }
    const mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'author-1', defaultThemeId: null }),
    }
    const themeSlot = new ThemeSlotUseCase(
      mockThemeRepo as any,
      mockAuthorRepo as any,
      membershipPort,
    )

    // 구독 전 — free 슬롯 1
    const before = await themeSlot.getSlotInfo('author-1')
    expect(before.slotLimit).toBe(1)
    expect(before.plan).toBe('free')

    // pro 구독 webhook → MembershipPlan.tier='pro'
    await subscriptionWebhook.execute(subEvent('created', 'pro', 'evt_4'))

    // 구독 후 — pro 슬롯 3 (changeTier → getPlan → resolveTierOrFree 사슬)
    const after = await themeSlot.getSlotInfo('author-1')
    expect(after.slotLimit).toBe(3)
    expect(after.plan).toBe('pro')

    // premium 으로 등급 변경 → 슬롯 8
    await subscriptionWebhook.execute(subEvent('updated', 'premium', 'evt_4b'))
    const afterUpgrade = await themeSlot.getSlotInfo('author-1')
    expect(afterUpgrade.slotLimit).toBe(8)
  })

  it('⑤ graceful — env 미설정 시 POST /subscriptions/checkout 503, getMembership·webhook 정상', async () => {
    // env 미설정 FakePaymentGateway → checkout 503
    const startSubscriptionNoEnv = new StartSubscriptionUseCase(
      new FakePaymentGateway(false) as any,
    )
    await expect(
      startSubscriptionNoEnv.execute('author-1', 'pro', 'https://grimoire-book.com/done'),
    ).rejects.toThrow(ServiceUnavailableException)

    // env 미설정이어도 webhook 수신은 정상 (changeTier 작동)
    const webhookResult = await subscriptionWebhook.execute(subEvent('created', 'pro', 'evt_5'))
    expect(webhookResult.processed).toBe(true)

    // env 미설정이어도 getMembership 정상
    const membership = await getMembership.execute('author-1')
    expect(membership.tier).toBe('pro')

    // env 설정 시 checkout 활성
    const startSubscriptionWithEnv = new StartSubscriptionUseCase(
      new FakePaymentGateway(true) as any,
    )
    const checkout = await startSubscriptionWithEnv.execute(
      'author-1',
      'pro',
      'https://grimoire-book.com/done',
    )
    expect(checkout.paymentUrl).toContain('polar.sh/subscribe/pro')
    expect(checkout.tradeNo).toBe('sub_checkout_pro')
  })

  it('⑥ 멱등성 — 동일 구독 webhook 2회 → changeTier 1회만', async () => {
    const event = subEvent('created', 'pro', 'evt_6_dup')

    const first = await subscriptionWebhook.execute(event)
    expect(first.processed).toBe(true)

    // 동일 eventId 재수신 — 멱등성 게이트로 skip
    const second = await subscriptionWebhook.execute(event)
    expect(second.processed).toBe(false)
    expect(second.reason).toBe('duplicate_event')

    // changeTier 는 단 1회만 호출됨
    expect(membershipPort.changeTierCalls).toBe(1)
  })

  it('⑦ 정기결제 갱신 ↔ cron 정합 (案 A 분리) — 구독 webhook 은 풀을 직접 리셋하지 않음', async () => {
    // 案 A — 풀 리셋은 cron(resetMonthlyPool) 단독. 구독 webhook 은 changeTier(등급)만.
    // pro 구독 후 풀 일부 소진 상태를 가정.
    await subscriptionWebhook.execute(subEvent('created', 'pro', 'evt_7a'))
    membershipPort.seed({
      ...(await membershipPort.getPlan('author-1'))!,
      poolBalance: 30000, // 풀 일부 소진
    })

    // subscription.updated (tier 불변 pro — 단순 갱신)이 와도 changeTier 가 풀 크기는
    // monthlyPoolPoints 로 재설정하나, 풀 리셋 책임은 cron 임을 명시.
    // 본 케이스는 "구독 webhook usecase 가 resetMonthlyPool 을 직접 호출하지 않음" 검증.
    const resetSpy = jest.spyOn(membershipPort, 'resetMonthlyPool')
    await subscriptionWebhook.execute(subEvent('updated', 'pro', 'evt_7b'))
    expect(resetSpy).not.toHaveBeenCalled() // 풀 리셋은 cron 단독 책임
    resetSpy.mockRestore()
  })
})
