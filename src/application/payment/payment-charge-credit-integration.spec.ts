/**
 * 크레딧 개편 CC-2a (2026-05-20) — 충전 결제 적립 연동 통합 테스트.
 *
 * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §1-A(T3 충전) + §6-2(settleDeficit / C-6)
 *       .claude/state/sprint-cc2a-charge-wiring-plan-draft.md §7
 *
 * ── 본 spec 의 존재 이유 (CRITICAL-2 충전분 근본 해결) ──
 * 직전 audit 에서 CRITICAL-2(적립 미연동)가 "unit PASS 인데 런타임 미연동"으로
 * 가려졌다. payment.usecase.spec 은 paymentRepo 를 mock 으로 대체하므로,
 * "충전 success 가 실제로 CreditLedger 에 earn row 를 박는지" 를 검증하지 못한다.
 *
 * 본 통합 spec 은 PaymentUseCase 의 **실 인스턴스**에 FakePaymentRepository 를
 * 주입하고, 그 FakePaymentRepository.completePaymentWithPoints 는 도메인 순수
 * 함수(computeChargeLedgerEntries)를 실제로 호출해 공유 CreditLedger store 에
 * row 를 박는다. 그 결과 "webhook success → completePaymentWithPoints →
 * CreditLedger charged earn row + deficit 상계" 호출 사슬 전체가 검증된다.
 *
 * ⚠️ RED 재현 (C7b): PaymentUseCase 충전 분기를 구 completePaymentAtomically 로
 * 되돌리면 CreditLedger 가 비어 본 spec 이 FAIL 한다 (CRITICAL-2 충전 미연동 재현).
 * 연동 완료 상태에서는 GREEN.
 *
 * 실 DB / 외부 API 미사용 (CLAUDE.md §4-8) — FakePaymentRepository 의
 * completePaymentWithPoints 는 prisma-payment.repository 와 동일한 도메인 헬퍼를
 * 호출해 deficit 상계·충전 적립 회계를 정확히 재현한다 (mock 이 아닌 fake).
 */
import { PaymentUseCase } from './payment.usecase'
import { computeChargeLedgerEntries } from '@domain/policy/credit-consumption-policy'
import { isChatBlockedByDeficit } from '@domain/policy/credit-consumption-policy'
import type { PaymentRecord } from '@domain/port/outbound/payment-repository.port'
import type { NormalizedWebhookEvent } from '@domain/port/outbound/payment-gateway.port'
import type {
  WebhookEventRecord,
  WebhookEventCreateInput,
} from '@domain/port/outbound/webhook-event-repository.port'

/** CreditLedger 1 테이블 + Author 4 출처 캐시 + deficit 를 재현하는 인메모리 store */
interface LedgerRow {
  authorId: string
  source: 'free' | 'subscription' | 'gift' | 'charged'
  type: 'earn' | 'spend' | 'deficit_incur' | 'deficit_settle' | 'expire'
  amount: number
  balanceAfter: number
  reason: string
  relatedId: string | null
}

class CreditStore {
  readonly rows: LedgerRow[] = []
  /** 작가별 4 출처 캐시 + deficit (Author 컬럼 동형) */
  private acc = new Map<
    string,
    { free: number; subscription: number; gift: number; charged: number; deficit: number }
  >()

  seed(
    authorId: string,
    init: Partial<{ free: number; subscription: number; gift: number; charged: number; deficit: number }>,
  ): void {
    this.acc.set(authorId, {
      free: init.free ?? 0,
      subscription: init.subscription ?? 0,
      gift: init.gift ?? 0,
      charged: init.charged ?? 0,
      deficit: init.deficit ?? 0,
    })
  }

  balanceOf(authorId: string) {
    let b = this.acc.get(authorId)
    if (!b) {
      b = { free: 0, subscription: 0, gift: 0, charged: 0, deficit: 0 }
      this.acc.set(authorId, b)
    }
    return b
  }

  earnRowsOf(authorId: string): LedgerRow[] {
    return this.rows.filter((r) => r.authorId === authorId && r.type === 'earn')
  }

  rowsByType(authorId: string, type: LedgerRow['type']): LedgerRow[] {
    return this.rows.filter((r) => r.authorId === authorId && r.type === type)
  }
}

/**
 * FakePaymentRepository — completePaymentWithPoints 가 prisma-payment.repository 와
 * 동일한 도메인 헬퍼(computeChargeLedgerEntries)를 호출해 CreditStore 에 실제로
 * deficit_settle / charged earn row 를 박는다. 이로써 통합 검증이 성립.
 */
class FakePaymentRepository {
  private payments = new Map<string, PaymentRecord>()

  constructor(private readonly store: CreditStore) {}

  seedPayment(p: PaymentRecord): void {
    this.payments.set(p.id, p)
  }

  async create(): Promise<PaymentRecord> {
    throw new Error('통합 spec 미사용 경로')
  }
  async findByExternalTransactionId(tradeNo: string): Promise<PaymentRecord | null> {
    return [...this.payments.values()].find((p) => p.externalTransactionId === tradeNo) ?? null
  }
  async updateExternalTransactionId(): Promise<void> {}
  async findByAuthorId(): Promise<PaymentRecord[]> {
    return []
  }
  async updateStatus(paymentId: string, status: string): Promise<void> {
    const p = this.payments.get(paymentId)
    if (p) p.status = status
  }
  async findPendingPaymentsOlderThan(): Promise<PaymentRecord[]> {
    return []
  }
  async expirePayment(): Promise<void> {}
  async findReusablePendingPayment(): Promise<PaymentRecord | null> {
    return null
  }
  // CC-4 Phase 1 — refundPaymentAtomically / completePaymentAtomically port 시그니처 제거.
  // Fake repository 도 제거 (구 경로 호출 자체 불가).

  /** CC-2b — 환불 신 경로. 본 CC-2a 통합 spec 에선 미사용(환불 케이스는 CC-2b 통합 spec). */
  async refundPaymentWithPoints(): Promise<{
    actualRefunded: number
    deficitIncurred: number
    proportionalPt: number
    isPartial: boolean
  }> {
    throw new Error('환불은 CC-2b 통합 spec 영역 — payment-charge-credit-integration 미사용')
  }

  /**
   * CC-2a 신 경로 — prisma-payment.repository.completePaymentWithPoints 와 동일 회계.
   * 단일 "트랜잭션"(fake) 으로 Payment 완료 + deficit 상계 + charged earn 박제.
   */
  async completePaymentWithPoints(
    paymentId: string,
    authorId: string,
    totalPoints: number,
    productId: string,
    relatedId?: string,
  ): Promise<{ settledDeficit: number; chargedPoints: number }> {
    const p = this.payments.get(paymentId)
    if (!p) throw new Error(`Payment not found: ${paymentId}`)
    const bal = this.store.balanceOf(authorId)

    // Payment 완료
    p.status = 'completed'
    p.completedAt = new Date()

    // 도메인 헬퍼 — prisma-payment.repository 와 동일
    const { settledDeficit, remainingCharge, remainingDeficit, newChargedCache } =
      computeChargeLedgerEntries(totalPoints, bal.deficit, bal.charged)

    // deficit 우선 상계
    if (settledDeficit > 0) {
      bal.deficit = remainingDeficit
      this.store.rows.push({
        authorId,
        source: 'charged',
        type: 'deficit_settle',
        amount: -settledDeficit,
        balanceAfter: bal.charged,
        reason: 'deficit_settle_on_charge',
        relatedId: relatedId ?? paymentId,
      })
    }

    // 남은 충전액 적립
    if (remainingCharge > 0) {
      bal.charged = newChargedCache
      const total = bal.free + bal.subscription + bal.gift + bal.charged
      this.store.rows.push({
        authorId,
        source: 'charged',
        type: 'earn',
        amount: remainingCharge,
        balanceAfter: total,
        reason: `purchase_${productId}`,
        relatedId: relatedId ?? paymentId,
      })
    }

    return { settledDeficit, chargedPoints: remainingCharge }
  }
}

/** WebhookEventRepository fake — 멱등성 게이트 재현 */
class FakeWebhookEventRepo {
  private events = new Map<string, WebhookEventRecord>()

  async findByEventId(eventId: string): Promise<WebhookEventRecord | null> {
    return this.events.get(eventId) ?? null
  }
  async createIfAbsent(input: WebhookEventCreateInput): Promise<WebhookEventRecord | null> {
    if (this.events.has(input.eventId)) return null
    const rec: WebhookEventRecord = {
      id: `whe-${input.eventId}`,
      eventId: input.eventId,
      source: input.source,
      eventType: input.eventType,
      status: input.status ?? 'processed',
      processedAt: new Date(),
    }
    this.events.set(input.eventId, rec)
    return rec
  }
  async markStatus(): Promise<void> {}
}

describe('CC-2a 충전 결제 적립 연동 통합 테스트 (CreditLedger 충전 earn 실 연동 검증)', () => {
  let store: CreditStore
  let paymentRepo: FakePaymentRepository
  let webhookEventRepo: FakeWebhookEventRepo
  let useCase: PaymentUseCase

  // 충전 패키지: 입문 ₩3,000 / 25,000pt
  const STARTER_POINTS = 25000

  /** webhook success event 생성 */
  const successEvent = (tradeNo: string): NormalizedWebhookEvent => ({
    eventId: `evt-${tradeNo}`,
    type: 'order.paid',
    tradeNo,
    amount: 3000,
    status: 'success',
  })

  /** Payment 시드 — 입문 패키지 (points 컬럼에 충전 총 pt 저장 — CC-4 Phase 2 rename) */
  const seedPayment = (id: string, authorId: string, tradeNo: string): void => {
    paymentRepo.seedPayment({
      id,
      authorId,
      productId: 'credit-starter',
      amount: 3000,
      points: STARTER_POINTS,
      externalTransactionId: tradeNo,
      status: 'pending',
      createdAt: new Date(),
      completedAt: null,
    })
  }

  beforeEach(() => {
    store = new CreditStore()
    paymentRepo = new FakePaymentRepository(store)
    webhookEventRepo = new FakeWebhookEventRepo()

    // authorRepo — 충전 success 분기 beforeState 조회용 (pointsCharged 캐시)
    const authorRepo = {
      findById: jest.fn().mockImplementation(async (id: string) => {
        const bal = store.balanceOf(id)
        return {
          id,
          slug: 's',
          name: 'N',
          email: 'e@e.com',
          role: 'user',
          credits: 0,
          plan: 'free',
          planExpireAt: null,
          createdAt: new Date(),
          deletedAt: null,
          pointsFree: bal.free,
          pointsSubscription: bal.subscription,
          pointsGift: bal.gift,
          pointsCharged: bal.charged,
          deficitPoints: bal.deficit,
        }
      }),
    }

    // paymentGateway — verifyAndParseWebhook 만 사용 (event 직접 주입)
    const paymentGateway = {
      initiatePayment: jest.fn(),
      verifyAndParseWebhook: jest.fn(),
    }

    const refundPaymentUseCase = { execute: jest.fn() }
    const auditLog = { log: jest.fn().mockResolvedValue(undefined) }

    // 실 PaymentUseCase — paymentRepo/webhookEventRepo 는 fake (도메인 회계 실제 수행)
    useCase = new PaymentUseCase(
      paymentRepo as never,
      paymentGateway as never,
      webhookEventRepo as never,
      refundPaymentUseCase as never,
      authorRepo as never,
      auditLog as never,
    )
  })

  // ─────────────────────────────────────────────────────────
  // C7b — 충전 적립: 충전 webhook 이 CreditLedger 에 charged earn row 를 박는가
  // ─────────────────────────────────────────────────────────
  describe('C7b — 충전 적립 (충전 success webhook → CreditLedger charged earn)', () => {
    it('충전 success webhook 처리 시 CreditLedger 에 source=charged·type=earn row 가 박힌다', async () => {
      seedPayment('pay-1', 'author-1', 'TRADE-1')

      const result = await useCase.processNormalizedWebhook(successEvent('TRADE-1'))

      expect(result.processed).toBe(true)

      // 미연동(구 completePaymentAtomically)이면 FakePaymentRepository 가 throw → FAIL.
      // 연동 완료면 CreditLedger 에 charged earn row 1건.
      const earnRows = store.earnRowsOf('author-1')
      expect(earnRows).toHaveLength(1)
      expect(earnRows[0]).toMatchObject({
        source: 'charged',
        type: 'earn',
        amount: STARTER_POINTS,
        relatedId: 'pay-1',
      })
    })

    it('충전 적립 후 Author.pointsCharged 캐시가 충전액만큼 가산된다', async () => {
      // 기존 충전 캐시 10,000pt
      store.seed('author-1', { charged: 10000 })
      seedPayment('pay-1', 'author-1', 'TRADE-1')

      await useCase.processNormalizedWebhook(successEvent('TRADE-1'))

      // 10,000 + 25,000 = 35,000
      expect(store.balanceOf('author-1').charged).toBe(35000)
    })

    it('CC-4 P1 — 구 completePaymentAtomically port 시그니처 자체 제거됨 (회귀 차단 완결)', async () => {
      // 본 it 는 CC-2a 미연동 회귀 방어용이었으나, CC-4 Phase 1 에서 구 메서드 port + 본문 + Fake
      // 모두 제거되어 컴파일러가 호출을 차단함. 정상 충전 동작만 회귀 확인.
      seedPayment('pay-1', 'author-1', 'TRADE-1')
      await expect(
        useCase.processNormalizedWebhook(successEvent('TRADE-1')),
      ).resolves.toMatchObject({ processed: true })
    })
  })

  // ─────────────────────────────────────────────────────────
  // C7c — 디노미 충전액: 입문 패키지 충전 → 25,000pt earn 정합
  // ─────────────────────────────────────────────────────────
  describe('C7c — 디노미 충전액 (입문 패키지 → 25,000pt)', () => {
    it('credit-starter 충전 시 CreditLedger earn amount 가 25,000pt 다', async () => {
      seedPayment('pay-1', 'author-1', 'TRADE-1')

      await useCase.processNormalizedWebhook(successEvent('TRADE-1'))

      const earnRows = store.earnRowsOf('author-1')
      expect(earnRows[0].amount).toBe(25000)
    })

    it('getProducts 가 디노미 4종을 반환한다', () => {
      const products = useCase.getProducts()
      expect(products).toHaveLength(4)
      expect(products.map((p) => p.id)).toEqual([
        'credit-starter',
        'credit-basic',
        'credit-popular',
        'credit-best',
      ])
      // 입문 패키지 총 pt 정합
      expect(products.find((p) => p.id === 'credit-starter')!.points).toBe(25000)
    })
  })

  // ─────────────────────────────────────────────────────────
  // C7d — C-6 해소: deficit 작가 충전 → deficit 상계 → 채팅 차단 해제
  // ─────────────────────────────────────────────────────────
  describe('C7d — C-6 해소 (deficit 10,000pt 작가 충전 → 상계 → isChatBlocked=false)', () => {
    it('deficit 10,000pt 작가가 충전하면 CreditLedger 에 deficit_settle row 가 박힌다', async () => {
      // 외상 상한 도달 — 채팅 차단 상태
      store.seed('author-1', { deficit: 10000 })
      expect(isChatBlockedByDeficit(store.balanceOf('author-1').deficit, 10000)).toBe(true)

      seedPayment('pay-1', 'author-1', 'TRADE-1')
      await useCase.processNormalizedWebhook(successEvent('TRADE-1'))

      // deficit_settle row 1건 — 충전이 외상을 상계
      const settleRows = store.rowsByType('author-1', 'deficit_settle')
      expect(settleRows).toHaveLength(1)
      expect(settleRows[0]).toMatchObject({
        source: 'charged',
        type: 'deficit_settle',
        amount: -10000, // 외상 10,000pt 전액 상계
      })
    })

    it('충전 후 deficitPoints 가 감소하고 isChatBlocked 가 false 로 바뀐다 (C-6 해소 핵심)', async () => {
      store.seed('author-1', { deficit: 10000 })
      seedPayment('pay-1', 'author-1', 'TRADE-1')

      await useCase.processNormalizedWebhook(successEvent('TRADE-1'))

      const bal = store.balanceOf('author-1')
      // 충전 25,000pt > 외상 10,000pt → 외상 전액 상계 → deficit 0
      expect(bal.deficit).toBe(0)
      // 충전해도 채팅 영구 차단되던 결함이 사라짐 — isChatBlocked=false
      expect(isChatBlockedByDeficit(bal.deficit, 10000)).toBe(false)
      // 남은 충전액 15,000pt 가 charged 캐시로 적립
      expect(bal.charged).toBe(15000)
    })

    it('충전액 < 외상이면 외상 일부만 상계 (charged earn 0건, deficit 부분 감소)', async () => {
      // 외상 40,000pt — 입문 충전 25,000pt 로 전부 못 갚음
      store.seed('author-1', { deficit: 40000 })
      seedPayment('pay-1', 'author-1', 'TRADE-1')

      await useCase.processNormalizedWebhook(successEvent('TRADE-1'))

      const bal = store.balanceOf('author-1')
      // 충전액 전부 외상 상계 → deficit 40,000 - 25,000 = 15,000
      expect(bal.deficit).toBe(15000)
      // charged 캐시 적립 0 (충전액 전부 외상 갚는 데 소진)
      expect(bal.charged).toBe(0)
      expect(store.earnRowsOf('author-1')).toHaveLength(0)
      // deficit_settle row 는 박힘 (상계 회계 추적)
      expect(store.rowsByType('author-1', 'deficit_settle')).toHaveLength(1)
    })
  })

  // ─────────────────────────────────────────────────────────
  // 멱등성 회귀 — 동일 eventId 충전 webhook 2회 → 적립 1회만
  // ─────────────────────────────────────────────────────────
  describe('멱등성 회귀 (동일 eventId 충전 webhook 2회 → CreditLedger earn 1건)', () => {
    it('동일 충전 webhook 재전송 시 charged earn row 가 중복 박히지 않는다', async () => {
      seedPayment('pay-1', 'author-1', 'TRADE-1')
      const ev = successEvent('TRADE-1')

      const first = await useCase.processNormalizedWebhook(ev)
      const second = await useCase.processNormalizedWebhook(ev)

      expect(first.processed).toBe(true)
      expect(second.processed).toBe(false)
      expect(second.reason).toBe('duplicate_event')

      // earn row 는 1건만 (멱등성 게이트가 두 번째 처리 차단)
      expect(store.earnRowsOf('author-1')).toHaveLength(1)
    })
  })
})
