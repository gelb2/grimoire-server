/**
 * 크레딧 개편 CC-2b (2026-05-20) — 선물(T4) + 환불(T7) + 이중 외상 통합 + CRITICAL-2 종결 증명.
 *
 * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §1-B(선물) / §1-C(환불) / §8
 *       .claude/state/sprint-cc2b-gift-refund-wiring-plan-draft.md §7 / §11
 *
 * ── 본 spec 의 존재 이유 (CRITICAL-2 선물·환불 근본 해결) ──
 *  CC-2a 와 동일 철학: unit PASS 여도 webhook/usecase 가 실제로 신 메서드를 호출하는지는
 *  unit mock 으로 보이지 않는다. 본 통합 spec 은:
 *   - CreditUseCase.gift 의 실 인스턴스 + 인메모리 CreditLedger fake → C7b 검증
 *   - PaymentUseCase 의 실 인스턴스 + FakePaymentRepository(도메인 헬퍼 실호출) → C7c 검증
 *   - 환불 외상 → 충전 시 자동 상계 → C7d 이중 외상 통합 + CRITICAL-2 종결 증명
 *
 * ⚠️ RED 재현:
 *  - C7b: CreditUseCase.gift 를 구 creditRepo.giftTransfer 로 되돌리면 FakePaymentRepository 가
 *    transfer 호출을 못 보고 본 spec FAIL.
 *  - C7c: PaymentUseCase cancel 분기가 구 refundPaymentAtomically 를 호출하면 FakePaymentRepository
 *    의 refundPaymentAtomically throw 로 FAIL (CRITICAL-2 환불 미연동 재현).
 *  - C7d: 충전 success 분기가 구 completePaymentAtomically 호출하면 외상 회수 실패.
 *
 *  실 DB / 외부 API 미사용 (CLAUDE.md §4-8).
 */
import { CreditUseCase } from './credit.usecase'
import { PaymentUseCase } from '@application/payment/payment.usecase'
import { RefundPaymentUseCase } from '@application/payment/refund-payment.usecase'
import {
  planConsumption,
  settleDeficitOnCharge,
  computeChargeLedgerEntries,
  computeRefundLedgerEntries,
} from '@domain/policy/credit-consumption-policy'
import type {
  CreditLedgerPort,
  CreditLedgerEntry,
  CreditBalance,
  SpendResult,
  EarnInput,
  SpendInput,
  TransferResult,
} from '@domain/port/outbound/credit-ledger.port'
import type { PaymentRecord } from '@domain/port/outbound/payment-repository.port'
import type { NormalizedWebhookEvent } from '@domain/port/outbound/payment-gateway.port'
import type {
  WebhookEventRecord,
  WebhookEventCreateInput,
} from '@domain/port/outbound/webhook-event-repository.port'

// ─────────────────────────────────────────────────────────
// 공통 store + fake (CC-1 / CC-2a 패턴 정합)
// ─────────────────────────────────────────────────────────

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
  private acc = new Map<
    string,
    { free: number; subscription: number; gift: number; charged: number; deficit: number }
  >()

  seed(
    authorId: string,
    init: Partial<{
      free: number
      subscription: number
      gift: number
      charged: number
      deficit: number
    }>,
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

  rowsOf(authorId: string): LedgerRow[] {
    return this.rows.filter((r) => r.authorId === authorId)
  }
  rowsByType(authorId: string, type: LedgerRow['type']): LedgerRow[] {
    return this.rows.filter((r) => r.authorId === authorId && r.type === type)
  }
}

/**
 * FakeCreditLedger — prisma-credit-ledger.repository 와 동일 도메인 헬퍼 사용 (mock 아닌 fake).
 * transfer/spend/settleDeficit/earn 전부 실제 회계 수행 → 통합 검증 성립.
 */
class FakeCreditLedger implements CreditLedgerPort {
  constructor(private readonly store: CreditStore) {}

  async earn(input: EarnInput): Promise<CreditLedgerEntry> {
    if (input.amount <= 0) throw new Error('적립액은 양수여야 합니다')
    const b = this.store.balanceOf(input.authorId)
    b[input.source] += input.amount
    const total = b.free + b.subscription + b.gift + b.charged
    const row: LedgerRow = {
      authorId: input.authorId,
      source: input.source,
      type: 'earn',
      amount: input.amount,
      balanceAfter: total,
      reason: input.reason,
      relatedId: input.relatedId ?? null,
    }
    this.store.rows.push(row)
    return { ...row, id: `l-${this.store.rows.length}`, expiresAt: null, createdAt: new Date() }
  }

  async spend(input: SpendInput): Promise<SpendResult> {
    const b = this.store.balanceOf(input.authorId)
    const plan = planConsumption(
      { free: b.free, subscription: b.subscription, gift: b.gift, charged: b.charged },
      input.amount,
    )
    const balanceAfter =
      b.free + b.subscription + b.gift + b.charged - plan.totalSpent
    for (const source of ['free', 'subscription', 'gift', 'charged'] as const) {
      const t = plan.spentBySource[source]
      if (t > 0) {
        b[source] -= t
        this.store.rows.push({
          authorId: input.authorId,
          source,
          type: 'spend',
          amount: -t,
          balanceAfter,
          reason: input.reason,
          relatedId: input.relatedId ?? null,
        })
      }
    }
    if (plan.deficitIncurred > 0) {
      b.deficit += plan.deficitIncurred
      this.store.rows.push({
        authorId: input.authorId,
        source: 'charged',
        type: 'deficit_incur',
        amount: -plan.deficitIncurred,
        balanceAfter,
        reason: input.reason,
        relatedId: input.relatedId ?? null,
      })
    }
    return {
      spentBySource: plan.spentBySource,
      deficitIncurred: plan.deficitIncurred,
      balanceAfter,
    }
  }

  async getBalance(authorId: string): Promise<CreditBalance> {
    const b = this.store.balanceOf(authorId)
    const total = b.free + b.subscription + b.gift + b.charged
    return {
      free: b.free,
      subscription: b.subscription,
      gift: b.gift,
      charged: b.charged,
      total,
      deficit: b.deficit,
      available: total - b.deficit,
    }
  }

  async settleDeficit(authorId: string, fromAmount: number): Promise<number> {
    const b = this.store.balanceOf(authorId)
    const { settledDeficit, remainingDeficit } = settleDeficitOnCharge(fromAmount, b.deficit)
    if (settledDeficit > 0) {
      b.deficit = remainingDeficit
      this.store.rows.push({
        authorId,
        source: 'charged',
        type: 'deficit_settle',
        amount: -settledDeficit,
        balanceAfter: b.charged,
        reason: 'deficit_settle_on_charge',
        relatedId: null,
      })
    }
    return settledDeficit
  }

  async findByAuthor(authorId: string, limit: number): Promise<CreditLedgerEntry[]> {
    return this.store
      .rowsOf(authorId)
      .slice(-limit)
      .reverse()
      .map((r, i) => ({ ...r, id: `l-${i}`, expiresAt: null, createdAt: new Date() }))
  }

  /**
   * 案 G1 — 案 G1 prisma-credit-ledger.repository.transfer 와 동일.
   * planConsumption 으로 sender 차감(deficit 금지) + receiver gift earn.
   */
  async transfer(
    senderId: string,
    receiverId: string,
    amount: number,
    relatedId?: string,
  ): Promise<TransferResult> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('선물 금액은 양의 정수여야 합니다')
    }
    if (senderId === receiverId) {
      throw new Error('자기 자신에게 선물할 수 없습니다')
    }
    const sender = this.store.balanceOf(senderId)
    const receiver = this.store.balanceOf(receiverId)
    const plan = planConsumption(
      {
        free: sender.free,
        subscription: sender.subscription,
        gift: sender.gift,
        charged: sender.charged,
      },
      amount,
    )
    if (plan.deficitIncurred > 0) {
      throw new Error('포인트가 부족합니다')
    }
    const senderBalanceAfter =
      sender.free + sender.subscription + sender.gift + sender.charged - amount
    for (const source of ['free', 'subscription', 'gift', 'charged'] as const) {
      const t = plan.spentBySource[source]
      if (t > 0) {
        sender[source] -= t
        this.store.rows.push({
          authorId: senderId,
          source,
          type: 'spend',
          amount: -t,
          balanceAfter: senderBalanceAfter,
          reason: `gift_sent:${receiverId}`,
          relatedId: relatedId ?? null,
        })
      }
    }
    receiver.gift += amount
    const receiverTotalAfter =
      receiver.free + receiver.subscription + receiver.gift + receiver.charged
    this.store.rows.push({
      authorId: receiverId,
      source: 'gift',
      type: 'earn',
      amount,
      balanceAfter: receiverTotalAfter,
      reason: `gift_received:${senderId}`,
      relatedId: relatedId ?? null,
    })
    return {
      senderSpentBySource: plan.spentBySource,
      receiverGiftBalance: receiver.gift,
    }
  }
}

/**
 * FakePaymentRepository — completePaymentWithPoints / refundPaymentWithPoints 가
 * prisma-payment.repository 와 동일한 도메인 헬퍼를 실제 호출.
 * 충전·환불 트랜잭션 회계가 통합 검증된다.
 */
class FakePaymentRepository {
  private payments = new Map<string, PaymentRecord>()

  constructor(private readonly store: CreditStore) {}

  seedPayment(p: PaymentRecord): void {
    this.payments.set(p.id, p)
  }

  async create(): Promise<PaymentRecord> {
    throw new Error('통합 spec 미사용')
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

  /** @deprecated CC-2b — 구 경로 호출 = 미연동 (RED 재현 감지) */
  async refundPaymentAtomically(): Promise<{
    actualDeducted: number
    deficitCredits: number
    proportionalCredits: number
    isPartial: boolean
  }> {
    throw new Error(
      'CC-2b: 환불 cancel 은 refundPaymentWithPoints 를 써야 한다 (구 경로 = 미연동)',
    )
  }

  /** @deprecated CC-2a — 구 충전 경로 (호출 시 RED) */
  async completePaymentAtomically(): Promise<void> {
    throw new Error('CC-2a: 충전 success 는 completePaymentWithPoints 를 써야 한다')
  }

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
    p.status = 'completed'
    p.completedAt = new Date()
    const { settledDeficit, remainingCharge, remainingDeficit, newChargedCache } =
      computeChargeLedgerEntries(totalPoints, bal.deficit, bal.charged)
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

  /** CC-2b — 案 R1: prisma-payment.repository.refundPaymentWithPoints 와 동일 회계 */
  async refundPaymentWithPoints(input: {
    paymentId: string
    authorId: string
    refundPt: number
    refundedAmount: number
    reason: string
    source: 'webhook' | 'manual'
  }): Promise<{
    actualRefunded: number
    deficitIncurred: number
    proportionalPt: number
    isPartial: boolean
  }> {
    const p = this.payments.get(input.paymentId)
    if (!p) throw new Error(`Payment not found: ${input.paymentId}`)
    if (p.amount <= 0) throw new Error('환불 불가 payment.amount')
    if (input.refundedAmount > p.amount) {
      throw new Error('환불 금액 초과')
    }
    const ratio = input.refundedAmount / p.amount
    const isPartial = ratio < 1.0
    const proportionalPt = isPartial ? Math.floor(input.refundPt * ratio) : input.refundPt

    p.status = isPartial ? 'partial_refunded' : 'refunded'

    const bal = this.store.balanceOf(input.authorId)
    const totalBefore = bal.free + bal.subscription + bal.gift + bal.charged
    const { recoveredBySource, totalRecovered, deficitIncurred } =
      computeRefundLedgerEntries(proportionalPt, {
        free: bal.free,
        subscription: bal.subscription,
        gift: bal.gift,
        charged: bal.charged,
      })
    const balanceAfter = totalBefore - totalRecovered

    for (const source of ['charged', 'gift', 'subscription', 'free'] as const) {
      const t = recoveredBySource[source]
      if (t > 0) {
        bal[source] -= t
        this.store.rows.push({
          authorId: input.authorId,
          source,
          type: 'spend',
          amount: -t,
          balanceAfter,
          reason: `refund_${input.paymentId}_${source}${isPartial ? '_partial' : ''}`,
          relatedId: input.paymentId,
        })
      }
    }

    if (deficitIncurred > 0) {
      // 이중 외상 통합 — Author.deficitPoints 가산
      bal.deficit += deficitIncurred
      this.store.rows.push({
        authorId: input.authorId,
        source: 'charged',
        type: 'deficit_incur',
        amount: -deficitIncurred,
        balanceAfter,
        reason: `refund_deficit:${input.paymentId}${isPartial ? '_partial' : ''}`,
        relatedId: input.paymentId,
      })
    }

    return {
      actualRefunded: totalRecovered,
      deficitIncurred,
      proportionalPt,
      isPartial,
    }
  }
}

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

// ─────────────────────────────────────────────────────────
// describe — CC-2b 통합 검증
// ─────────────────────────────────────────────────────────

describe('CC-2b — 선물·환불 신 시스템 연동 + 이중 외상 통합 (CRITICAL-2 종결 증명)', () => {
  let store: CreditStore
  let ledger: FakeCreditLedger
  let paymentRepo: FakePaymentRepository
  let webhookEventRepo: FakeWebhookEventRepo
  let creditUseCase: CreditUseCase
  let paymentUseCase: PaymentUseCase
  let refundUseCase: RefundPaymentUseCase

  // 충전 패키지 — 입문 ₩3,000 / 25,000pt (CC-2a 디노미)
  const STARTER_POINTS = 25000

  const cancelEvent = (tradeNo: string, amount = 3000): NormalizedWebhookEvent => ({
    eventId: `evt-cancel-${tradeNo}`,
    type: 'order.refunded',
    tradeNo,
    amount,
    status: 'cancel',
  })

  const successEvent = (tradeNo: string, amount = 3000): NormalizedWebhookEvent => ({
    eventId: `evt-success-${tradeNo}`,
    type: 'order.paid',
    tradeNo,
    amount,
    status: 'success',
  })

  // 환불 webhook 대상 — payment.usecase 사전 게이트(line 296)는 status='completed' 를 차단하므로
  // 'pending' 으로 시드(payment.usecase.spec 패턴 정합). refundPaymentWithPoints 내부에서
  // payment 조회는 별도이며 status 검증이 없음(amount > 0 만 검증).
  const seedPayment = (id: string, authorId: string, tradeNo: string): void => {
    paymentRepo.seedPayment({
      id,
      authorId,
      productId: 'credit-starter',
      amount: 3000,
      credits: STARTER_POINTS,
      externalTransactionId: tradeNo,
      status: 'pending',
      createdAt: new Date(),
      completedAt: null,
    })
  }

  beforeEach(() => {
    store = new CreditStore()
    ledger = new FakeCreditLedger(store)
    paymentRepo = new FakePaymentRepository(store)
    webhookEventRepo = new FakeWebhookEventRepo()

    // authorRepo — 작가 존재 검증용 (CreditUseCase.gift + payment.usecase 사용)
    const authorRepo = {
      findById: jest.fn().mockImplementation(async (id: string) => {
        const b = store.balanceOf(id)
        return {
          id,
          slug: id,
          name: id,
          email: `${id}@e.com`,
          role: 'user',
          credits: 0,
          plan: 'free',
          planExpireAt: null,
          createdAt: new Date(),
          deletedAt: null,
          pointsFree: b.free,
          pointsSubscription: b.subscription,
          pointsGift: b.gift,
          pointsCharged: b.charged,
          deficitPoints: b.deficit,
        }
      }),
    }
    const creditRepo = {
      adjustCredits: jest.fn(),
      giftTransfer: jest.fn().mockRejectedValue(
        new Error(
          'CC-2b: 선물은 ledger.transfer 를 써야 한다 (구 creditRepo.giftTransfer = 미연동)',
        ),
      ),
      getGiftRanking: jest.fn().mockResolvedValue([]),
      findLogsByAuthorId: jest.fn().mockResolvedValue([]),
      sumNegativeAmounts: jest.fn(),
    }

    // 실 CreditUseCase — ledger fake + authorRepo fake
    creditUseCase = new CreditUseCase(
      creditRepo as never,
      authorRepo as never,
      ledger,
    )

    // 실 RefundPaymentUseCase — paymentRepo fake + ledger 주입 (balanceBefore 4 출처)
    const auditLog = { log: jest.fn().mockResolvedValue(undefined), findAll: jest.fn() }
    refundUseCase = new RefundPaymentUseCase(
      paymentRepo as never,
      auditLog as never,
      authorRepo as never,
      ledger,
    )

    const paymentGateway = {
      initiatePayment: jest.fn(),
      verifyAndParseWebhook: jest.fn(),
    }
    // 실 PaymentUseCase — paymentRepo / webhookEventRepo / refundUseCase 전부 실 또는 fake
    paymentUseCase = new PaymentUseCase(
      paymentRepo as never,
      paymentGateway as never,
      webhookEventRepo as never,
      refundUseCase,
      authorRepo as never,
      auditLog as never,
    )

    // PaymentGateway 는 직접 event 주입 (verifyAndParseWebhook 만 사용)
    ;(paymentGateway.verifyAndParseWebhook as jest.Mock).mockImplementation(() => {
      // 실 호출 시점에 따라 set
      throw new Error('Test must set verifyAndParseWebhook explicitly')
    })
    ;(paymentUseCase as unknown as { paymentGateway: typeof paymentGateway }).paymentGateway =
      paymentGateway
  })

  /** processWebhook 가 paymentGateway.verifyAndParseWebhook 결과로 분기 — event 를 set 후 호출 */
  async function callWebhook(event: NormalizedWebhookEvent) {
    const gateway = (paymentUseCase as unknown as {
      paymentGateway: { verifyAndParseWebhook: jest.Mock }
    }).paymentGateway
    gateway.verifyAndParseWebhook.mockReturnValueOnce(event)
    return paymentUseCase.processWebhook('{}', { 'webhook-signature': 'x' })
  }

  // ─────────────────────────────────────────────────────────
  // C7b — T4 선물 통합: gift webhook → ledger.transfer → 양측 CreditLedger row
  // ─────────────────────────────────────────────────────────
  describe('C7b — T4 선물 통합 (CreditUseCase.gift → CreditLedger 양측 이동)', () => {
    it('선물 1,000pt — sender charged 차감 spend + receiver gift earn 양측 row 박제', async () => {
      // sender(독자) charged 5,000pt / receiver(작가) 잔액 0
      store.seed('reader-1', { charged: 5000 })
      store.seed('author-1', {})

      const result = await creditUseCase.gift('reader-1', 'author-1', 1000)

      // 案 G1 반환 정합
      expect(result.senderSpentBySource).toEqual({
        free: 0,
        subscription: 0,
        gift: 0,
        charged: 1000,
      })
      expect(result.receiverGiftBalance).toBe(1000)

      // sender 측 — charged 출처 spend row
      const senderSpend = store.rowsByType('reader-1', 'spend')
      expect(senderSpend).toHaveLength(1)
      expect(senderSpend[0]).toMatchObject({
        source: 'charged',
        amount: -1000,
        reason: 'gift_sent:author-1',
      })

      // receiver 측 — gift earn row
      const receiverEarn = store.rowsByType('author-1', 'earn')
      expect(receiverEarn).toHaveLength(1)
      expect(receiverEarn[0]).toMatchObject({
        source: 'gift',
        type: 'earn',
        amount: 1000,
        reason: 'gift_received:reader-1',
      })

      // 캐시 정합 — sender charged -1000 / receiver gift +1000
      expect(store.balanceOf('reader-1').charged).toBe(4000)
      expect(store.balanceOf('author-1').gift).toBe(1000)
    })

    it('선물 소진 우선순위 — sender 무료 우선 차감 (free→subscription→gift→charged)', async () => {
      // sender free 500 / charged 5000 → 1,000 선물 시 free 500 + charged 500 분산
      store.seed('reader-2', { free: 500, charged: 5000 })
      store.seed('author-2', {})

      const result = await creditUseCase.gift('reader-2', 'author-2', 1000)

      expect(result.senderSpentBySource.free).toBe(500)
      expect(result.senderSpentBySource.charged).toBe(500)

      // sender 측 spend row 2건 (free + charged)
      const senderSpend = store.rowsByType('reader-2', 'spend')
      expect(senderSpend).toHaveLength(2)
      // receiver gift earn 1건
      expect(store.rowsByType('author-2', 'earn')).toHaveLength(1)
    })

    it('sender 잔액 부족 시 BadRequest — 외상 선물 불가 (案 G1 deficit 금지)', async () => {
      store.seed('reader-3', { charged: 500 })
      store.seed('author-3', {})

      await expect(creditUseCase.gift('reader-3', 'author-3', 1000)).rejects.toThrow(
        '포인트가 부족',
      )

      // 미연동 시 sender 측에 row 가 박힘 — 정상 시 throw 로 트랜잭션 롤백 → row 0건
      expect(store.rowsOf('reader-3')).toHaveLength(0)
      expect(store.rowsOf('author-3')).toHaveLength(0)
    })

    it('자기 선물 BadRequest', async () => {
      store.seed('user-self', { charged: 5000 })
      await expect(creditUseCase.gift('user-self', 'user-self', 1000)).rejects.toThrow(
        '자기',
      )
    })
  })

  // ─────────────────────────────────────────────────────────
  // C7c — T7 환불 통합: 환불 webhook → refundPaymentWithPoints → 4 출처 환수
  // ─────────────────────────────────────────────────────────
  describe('C7c — T7 환불 통합 (PaymentUseCase cancel → CreditLedger 4 출처 환수)', () => {
    it('전액 환불 정상 — charged 25,000pt 환수 + RefundLog credits=25000 + Author.deficitPoints 0', async () => {
      // 충전 적립 25,000pt 완료된 작가
      store.seed('author-A', { charged: 25000 })
      seedPayment('pay-A', 'author-A', 'TRADE-A')

      const result = await callWebhook(cancelEvent('TRADE-A', 3000))

      expect(result.processed).toBe(true)
      // payment.usecase 응답 deficitCredits = deficitIncurred 매핑
      expect(result).toHaveProperty('deficitCredits', 0)

      // charged 출처 spend row 1건 + deficit_incur 0건
      const spendRows = store.rowsByType('author-A', 'spend')
      expect(spendRows).toHaveLength(1)
      expect(spendRows[0]).toMatchObject({ source: 'charged', amount: -25000 })
      expect(store.rowsByType('author-A', 'deficit_incur')).toHaveLength(0)

      // Author.deficitPoints 가산 0
      expect(store.balanceOf('author-A').deficit).toBe(0)
      expect(store.balanceOf('author-A').charged).toBe(0)
    })

    it('잔액 부족 환불 — 환수 가능액 차감 + 부족분 Author.deficitPoints 가산 (이중 외상 통합)', async () => {
      // 작가가 이미 일부 소진해서 10,000pt 만 남은 상태 → 25,000pt 환불 시 15,000pt 외상 발생
      store.seed('author-B', { charged: 10000 })
      seedPayment('pay-B', 'author-B', 'TRADE-B')

      const result = await callWebhook(cancelEvent('TRADE-B', 3000))

      expect(result.processed).toBe(true)
      // deficit 15,000pt 응답
      expect(result).toHaveProperty('deficitCredits', 15000)

      // charged 환수 spend 1건 (10,000) + deficit_incur 1건 (15,000)
      const spendRows = store.rowsByType('author-B', 'spend')
      expect(spendRows).toHaveLength(1)
      expect(spendRows[0]).toMatchObject({ source: 'charged', amount: -10000 })
      const deficitRows = store.rowsByType('author-B', 'deficit_incur')
      expect(deficitRows).toHaveLength(1)
      expect(deficitRows[0]).toMatchObject({
        type: 'deficit_incur',
        amount: -15000,
        reason: expect.stringContaining('refund_deficit:pay-B'),
      })

      // 이중 외상 통합 — Author.deficitPoints += 15,000 (구 RefundLog.deficitCredits 만 박던 외상이 단일 장부로)
      expect(store.balanceOf('author-B').deficit).toBe(15000)
      expect(store.balanceOf('author-B').charged).toBe(0)
    })

    it('부분 환불 (50%) — proportionalPt 비례 계산 + paymentStatus partial_refunded', async () => {
      store.seed('author-C', { charged: 25000 })
      seedPayment('pay-C', 'author-C', 'TRADE-C')

      // 부분 환불 — 결제 ₩3,000 의 절반 ₩1,500 환불 → 12,500pt 환수
      const result = await callWebhook(cancelEvent('TRADE-C', 1500))

      expect(result.processed).toBe(true)
      const spendRows = store.rowsByType('author-C', 'spend')
      expect(spendRows).toHaveLength(1)
      // Math.floor(25000 * 0.5) = 12500
      expect(spendRows[0].amount).toBe(-12500)
      expect(spendRows[0].reason).toContain('_partial')
      expect(store.balanceOf('author-C').charged).toBe(12500)
      expect(store.balanceOf('author-C').deficit).toBe(0)
    })

    it('환불 우선순위 — charged 부족 시 gift → subscription → free 역방향 환수', async () => {
      // charged 5,000 / gift 5,000 / subscription 10,000 / free 5,000 → 환불 25,000pt
      store.seed('author-D', { free: 5000, subscription: 10000, gift: 5000, charged: 5000 })
      seedPayment('pay-D', 'author-D', 'TRADE-D')

      await callWebhook(cancelEvent('TRADE-D', 3000))

      const spendRows = store.rowsByType('author-D', 'spend')
      // 4 출처 분산 환수 — charged 우선
      const bySource = Object.fromEntries(
        spendRows.map((r) => [r.source, -r.amount]),
      )
      expect(bySource.charged).toBe(5000)
      expect(bySource.gift).toBe(5000)
      expect(bySource.subscription).toBe(10000)
      expect(bySource.free).toBe(5000)
      expect(store.balanceOf('author-D').deficit).toBe(0)
    })
  })

  // ─────────────────────────────────────────────────────────
  // C7d — 이중 외상 통합: 환불 외상 → 충전 시 자동 회수 (CRITICAL-2 종결)
  // ─────────────────────────────────────────────────────────
  describe('C7d — 이중 외상 통합 + CRITICAL-2 종결 (환불 외상 → 충전 시 자동 상계)', () => {
    it('환불로 발생한 deficit 가 다음 충전 시 completePaymentWithPoints 의 settleDeficit 로 자동 회수된다', async () => {
      // step1: charged 10,000 작가가 환불 25,000pt → 환수 10,000 + deficit 15,000 발생
      store.seed('author-X', { charged: 10000 })
      seedPayment('pay-refund', 'author-X', 'TRADE-refund')
      await callWebhook(cancelEvent('TRADE-refund', 3000))

      expect(store.balanceOf('author-X').deficit).toBe(15000)
      expect(store.balanceOf('author-X').charged).toBe(0)

      // step2: 작가가 25,000pt 충전 → CC-2a 가 deficit 우선 상계
      paymentRepo.seedPayment({
        id: 'pay-charge',
        authorId: 'author-X',
        productId: 'credit-starter',
        amount: 3000,
        credits: STARTER_POINTS,
        externalTransactionId: 'TRADE-charge',
        status: 'pending',
        createdAt: new Date(),
        completedAt: null,
      })
      const chargeResult = await callWebhook(successEvent('TRADE-charge', 3000))

      expect(chargeResult.processed).toBe(true)

      // 통합 검증 — deficit 자동 회수
      // - deficit 15,000 상계 + 남은 10,000pt 가 charged 캐시로 적립
      expect(store.balanceOf('author-X').deficit).toBe(0)
      expect(store.balanceOf('author-X').charged).toBe(10000)

      // deficit_settle row 박제 박제 (CC-2a 가 환불 외상도 회수)
      const settleRows = store.rowsByType('author-X', 'deficit_settle')
      expect(settleRows).toHaveLength(1)
      expect(settleRows[0]).toMatchObject({
        type: 'deficit_settle',
        amount: -15000,
        reason: 'deficit_settle_on_charge',
      })

      // 충전 적립 earn row 1건 — 상계 후 남은 10,000pt
      const earnRows = store.rowsByType('author-X', 'earn')
      expect(earnRows).toHaveLength(1)
      expect(earnRows[0]).toMatchObject({
        source: 'charged',
        type: 'earn',
        amount: 10000,
      })

      // 구 시스템에서는 RefundLog.deficitCredits 가 영구 외상이었음. CC-2b 통합으로 회수 경로 확립.
    })

    it('CRITICAL-2 종결 증명 — 선물·환불·충전 사슬이 전부 CreditLedger 신 시스템으로 흐른다', async () => {
      // 선물 → 충전 → 환불 1 시나리오로 적립 8경로 中 T3/T4/T7 신 시스템 동시 검증
      store.seed('reader-K', { charged: 3000 })
      store.seed('author-K', {})

      // T4 선물 1,000pt
      await creditUseCase.gift('reader-K', 'author-K', 1000)
      expect(store.balanceOf('author-K').gift).toBe(1000)

      // T3 충전 — 작가 자기 25,000pt 충전 (구독 작가가 충전도 함)
      paymentRepo.seedPayment({
        id: 'pay-K1',
        authorId: 'author-K',
        productId: 'credit-starter',
        amount: 3000,
        credits: STARTER_POINTS,
        externalTransactionId: 'TRADE-K1',
        status: 'pending',
        createdAt: new Date(),
        completedAt: null,
      })
      await callWebhook(successEvent('TRADE-K1', 3000))
      expect(store.balanceOf('author-K').charged).toBe(25000)

      // T7 환불 — 작가가 충전 취소 (status='pending' — payment.usecase 사전 게이트 우회 위해)
      paymentRepo.seedPayment({
        id: 'pay-K2',
        authorId: 'author-K',
        productId: 'credit-starter',
        amount: 3000,
        credits: STARTER_POINTS,
        externalTransactionId: 'TRADE-K2',
        status: 'pending',
        createdAt: new Date(),
        completedAt: null,
      })
      // 환불 대상은 별도 payment — 25,000pt 환수, charged 잔액 25,000 충분
      await callWebhook(cancelEvent('TRADE-K2', 3000))

      // 통합 검증 — 전부 CreditLedger 에 흐름이 박혀 있음
      const earnRows = store.rowsByType('author-K', 'earn')
      // gift 1건 + charged 1건
      expect(earnRows.filter((r) => r.source === 'gift')).toHaveLength(1)
      expect(earnRows.filter((r) => r.source === 'charged')).toHaveLength(1)

      const spendRows = store.rowsByType('author-K', 'spend')
      // 환불 spend 1건 (charged 25,000)
      expect(spendRows.filter((r) => r.source === 'charged')).toHaveLength(1)

      // 구 CreditLog 박제 0건 검증 — 본 fake 가 CreditLog 영역을 다루지 않음으로 자동
      // (CreditUseCase.gift 가 creditRepo.giftTransfer 호출했다면 fake 가 throw 했을 것 — RED 차단)
    })
  })
})
