import { Injectable, Inject, BadRequestException, Logger, Optional, ServiceUnavailableException } from '@nestjs/common'
import { PaymentRepositoryPort } from '@domain/port/outbound/payment-repository.port'
import { PaymentGatewayPort, isSubscriptionEvent } from '@domain/port/outbound/payment-gateway.port'
import { WebhookEventRepositoryPort } from '@domain/port/outbound/webhook-event-repository.port'
import { ProcessSubscriptionWebhookUseCase } from '@application/subscription/process-subscription-webhook.usecase'
import { WebhookRetryQueueRepositoryPort } from '@domain/port/outbound/webhook-retry-queue-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CREDIT_PRODUCTS, Product } from '@domain/model/config'
import { RefundPaymentUseCase } from './refund-payment.usecase'
import { PaymentNotificationUseCase } from './payment-notification.usecase'
import { AuditLogService } from '@application/admin/audit-log.service'
import { CircuitOpenError } from '@domain/model/circuit-breaker-state'
// PAY-P3-D Status enum mapping (도메인 어휘 통일 — shared-contracts §28 / ADR-010)
import {
  PAYMENT_STATUS,
  WEBHOOK_EVENT_STATUS,
  NORMALIZED_WEBHOOK_STATUS,
  isPaymentAlreadyRefunded,
} from '@domain/model/payment-status'

// re-export for backward compatibility
export { CREDIT_PRODUCTS, type Product }

@Injectable()
export class PaymentUseCase {
  private readonly logger = new Logger(PaymentUseCase.name)
  /** PAY-P2-2 첫 재시도 백오프 — 1분 후 (이후 WebhookRetryJob이 백오프 계산) */
  private static readonly INITIAL_RETRY_DELAY_MS = 60_000

  constructor(
    @Inject('PaymentRepositoryPort') private readonly paymentRepo: PaymentRepositoryPort,
    @Inject('PaymentGatewayPort') private readonly paymentGateway: PaymentGatewayPort,
    @Inject('WebhookEventRepositoryPort') private readonly webhookEventRepo: WebhookEventRepositoryPort,
    private readonly refundPaymentUseCase: RefundPaymentUseCase,
    /**
     * PAY-P2-4 — webhook 'success' 분기에서 잔액 사전 조회 (beforeState 박제용).
     * Optional이지만 실 운영(`app.module.ts`)에서는 항상 주입됨.
     */
    @Optional()
    @Inject('AuthorRepositoryPort')
    private readonly authorRepo: AuthorRepositoryPort | null = null,
    /**
     * PAY-P2-4 — webhook 'success' 분기에서 audit log 박제 (트랜잭션 외 후행).
     * Optional이지만 실 운영(`app.module.ts`)에서는 항상 주입됨.
     */
    @Optional()
    private readonly auditLog: AuditLogService | null = null,
    /**
     * PAY-P2-2 — webhook 처리 실패 시 재시도 큐 박제. Optional (선택 의존)이므로
     * 미주입 시 기존 동작 (Polar 자체 retry만 의존) 보존.
     */
    @Optional()
    @Inject('WebhookRetryQueueRepositoryPort')
    private readonly retryQueueRepo: WebhookRetryQueueRepositoryPort | null = null,
    /**
     * CC-5 (PAY-P1-4) — 구독 생명주기 webhook 라우팅. Optional —
     * 미주입 시 구독 webhook 은 'ignored' 처리(회귀 보존). 실 운영은 app.module 주입.
     */
    @Optional()
    private readonly subscriptionWebhookUseCase: ProcessSubscriptionWebhookUseCase | null = null,
    /**
     * EMAIL-POLAR-READY Phase D (2026-05-27) — 결제 알림 호출점.
     * Optional — 미주입 시 알림 skip (회귀 보존). 실 운영은 app.module 주입.
     * 트랜잭션 외부 + try/catch (결제 commit 보존 — CLAUDE.md §9 정합).
     * NullAdapter (default) 시 isEnabled=false → 호출 0건.
     */
    @Optional()
    private readonly notificationUseCase: PaymentNotificationUseCase | null = null,
  ) {}

  /**
   * webhook 처리 실패 시 재시도 큐에 박제 (PAY-P2-2).
   * eventId @unique이므로 중복 박제 시 P2002 → null 반환 (재처리 시점에는 markRetry로 retryCount 증가).
   * retryQueueRepo 미주입 시 무동작 (회귀 보존).
   *
   * PAY-P3-B 보강: eventClass='permanent_failed' 시 retry queue 박제 0건 (4xx 분기 — retry 무의미).
   * 기본값 'retry' (회귀 보존).
   */
  private async enqueueWebhookRetry(
    event: object,
    eventId: string,
    eventClass: 'retry' | 'permanent_failed' = 'retry',
  ): Promise<void> {
    if (eventClass === 'permanent_failed') {
      // PAY-P3-B: 4xx → retry queue 박제 0건 (retry 무의미 — 즉시 permanent_failed)
      return
    }
    if (!this.retryQueueRepo) return
    try {
      await this.retryQueueRepo.upsert({
        eventId,
        payload: event,
        nextRetryAt: new Date(Date.now() + PaymentUseCase.INITIAL_RETRY_DELAY_MS),
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.warn(`webhook retry queue 박제 실패 (eventId=${eventId}): ${msg}`)
    }
  }

  /**
   * PAY-P3-B 구멍-C 차단: catch 블록에서 Polar SDK exception 분류 후 분기 처리.
   * 정본: shared-contracts §24 PolarSDKTimeoutPolicy.
   *
   * - client_4xx → permanent_failed 즉시 박제 (retry queue 0건 + AuditLog `webhook_permanent_failed`)
   * - 외 4분류 (timeout/network/server_5xx/unknown) → retry queue 박제 (기존 enqueueWebhookRetry)
   *
   * paymentGateway.classifyPolarError 미구현 시 'unknown' fallback (회귀 보존).
   */
  private async classifyAndRouteWebhookError(
    e: unknown,
    event: import('@domain/port/outbound/payment-gateway.port').NormalizedWebhookEvent,
    paymentId: string,
    branch: 'success' | 'cancel',
  ): Promise<{
    errorClass: import('@domain/port/outbound/payment-gateway.port').PolarErrorClass
    message: string
    httpStatus?: number
  }> {
    const polarError =
      this.paymentGateway.classifyPolarError?.(e) ?? {
        errorClass: 'unknown' as const,
        message: e instanceof Error ? e.message : String(e),
      }

    const httpStatusLabel = polarError.httpStatus ?? 'N/A'

    if (polarError.errorClass === 'client_4xx') {
      // 4xx — retry 무의미, 즉시 permanent_failed 박제
      this.logger.error(
        `[PolarSDK] client_4xx eventId=${event.eventId} branch=${branch} httpStatus=${httpStatusLabel} paymentId=${paymentId} → permanent_failed (retry 0건)`,
      )
      if (this.auditLog) {
        try {
          await this.auditLog.log(
            'system_dlq',
            'webhook_permanent_failed',
            event.eventId,
            {
              reason: 'polar_4xx_no_retry',
              errorClass: polarError.errorClass,
              httpStatus: polarError.httpStatus,
              paymentId,
              branch,
              originalMessage: polarError.message.slice(0, 500),
            },
          )
        } catch (auditErr: unknown) {
          this.logger.warn(
            `AuditLog 박제 실패 (4xx permanent_failed eventId=${event.eventId}): ${
              auditErr instanceof Error ? auditErr.message : String(auditErr)
            }`,
          )
        }
      }
      // enqueueWebhookRetry 호출 0건 (retry queue 박제 0건) — eventClass='permanent_failed' 명시
      await this.enqueueWebhookRetry(
        event as unknown as object,
        event.eventId,
        'permanent_failed',
      )
    } else {
      // timeout / network / server_5xx / unknown — retry 의미 있음
      this.logger.warn(
        `[PolarSDK] ${polarError.errorClass} eventId=${event.eventId} branch=${branch} httpStatus=${httpStatusLabel} paymentId=${paymentId} → retry`,
      )
      await this.enqueueWebhookRetry(event as unknown as object, event.eventId, 'retry')
    }

    return polarError
  }

  /**
   * 충전 패키지 목록 조회 (CC-2a — 디노미 4종).
   *
   * 응답: `points`(총 충전 pt) + `bonusRate`(보너스율) + `pricePerPoint`(pt 당 충전 단가).
   * 구 `credits`/`pricePerCredit` → `points`/`pricePerPoint` 로 디노미 환산.
   * web 충전 패키지 UI 가 4종을 받게 됨 (shared-contracts §30 — web 핸드오프).
   */
  getProducts() {
    return CREDIT_PRODUCTS.map((p) => ({
      id: p.id,
      name: p.name,
      points: p.points,
      bonusRate: p.bonusRate,
      price: p.price,
      // pt 당 충전 단가 (원화) — 표면 단가. 보너스 포함 총 pt 기준.
      pricePerPoint: Number((p.price / p.points).toFixed(5)),
    }))
  }

  /**
   * 결제 시작 — Payment 레코드 생성 또는 24h 이내 pending 재사용 + 게이트웨이 호출.
   *
   * Sprint PAY-P1-3 (정본: `.claude/shared-contracts.md` §14):
   * 1. findReusablePendingPayment(authorId, productId, expireSince=now-24h) 진입 게이트
   * 2. 적중 시 → Payment row 신규 생성 SKIP, 동일 paymentId 재사용 (DB row 폭주 차단)
   * 3. null 반환 시 → 신규 create (기존 흐름)
   * 4. 분기 무관 — paymentGateway.initiatePayment 호출 (Polar Checkout URL 신규 발급, 매 호출 신규)
   * 5. paymentRepo.updateExternalTransactionId — 재사용 row의 externalTransactionId를 새 tradeNo로 갱신
   *
   * Polar SDK 정책: Checkout URL은 매 호출마다 신규 발급 (같은 externalTransactionId 재발급 불가).
   * 사용자 UX: 응답 paymentId는 재사용 분기에서도 동일 → 중복 클릭/탭 닫음 후 재시도해도 row 폭증 0건.
   */
  async initiatePayment(authorId: string, productId: string, returnUrl: string) {
    const product = CREDIT_PRODUCTS.find((p) => p.id === productId)
    if (!product) throw new BadRequestException(`존재하지 않는 상품입니다: ${productId}`)

    // PAY-P1-3 진입 게이트 — 24h 이내 동일 productId pending row 재사용
    const expireSince = new Date(Date.now() - PaymentUseCase.PENDING_REUSE_HOURS * 60 * 60 * 1000)
    const reusable = await this.paymentRepo.findReusablePendingPayment(authorId, product.id, expireSince)

    let payment = reusable
    if (!payment) {
      // [CC-2a 박제 + CC-4 Phase 2 rename] Payment.points Int 에 충전 총 pt 를 저장.
      // 구 컬럼명 `credits` → `points` 물리 rename 완료 (마이그레이션 20260521_payment_credits_rename_phase2).
      payment = await this.paymentRepo.create({
        authorId, productId: product.id, amount: product.price, points: product.points,
      })
    } else {
      this.logger.log(
        `[reuse] 24h 이내 pending 재사용 — paymentId=${payment.id} authorId=${authorId} productId=${product.id}`,
      )
    }

    // PAY-P3-H: CircuitOpenError 분기 — fail-fast 영역 (retry queue 박제 0건 강제).
    // Circuit Breaker가 OPEN 상태면 SDK 호출 0건 + 즉시 503 응답.
    // 정본: shared-contracts §27 CircuitBreakerPolicy, ADR-009.
    let result
    try {
      result = await this.paymentGateway.initiatePayment({
        productId: product.id, productName: product.name, amount: product.price, userId: authorId, returnUrl,
      })
    } catch (e: unknown) {
      if (e instanceof CircuitOpenError) {
        this.logger.warn(
          `[CircuitBreaker] initiatePayment fail-fast — circuit=${e.circuitKey} authorId=${authorId} productId=${productId}`,
        )
        // AuditLog circuit_breaker.reject 박제는 in-memory-circuit-breaker.adapter 영역에서 이미 박제.
        // 본 usecase = 사용자 친화 503 응답 (운영 영역 사용자 재시도 결정 영역).
        throw new ServiceUnavailableException('결제 서비스 일시 차단 중 — 잠시 후 재시도')
      }
      throw e
    }

    // 재사용 분기에서도 항상 호출 — Polar 정책상 매 결제 시도마다 신규 tradeNo 발급되므로 갱신 필수
    await this.paymentRepo.updateExternalTransactionId(payment.id, result.tradeNo)

    return { paymentId: payment.id, paymentUrl: result.paymentUrl, tradeNo: result.tradeNo }
  }

  /** PAY-P1-3 — pending Payment 재사용 가능 시간 (시간 단위, 24h) */
  private static readonly PENDING_REUSE_HOURS = 24

  /**
   * 웹훅 처리 — 서명 검증 + 멱등성 게이트(Sprint PAY-P0-1) + 크레딧 부여
   *
   * 게이트 순서:
   * 1. verifyAndParseWebhook → eventId 포함된 NormalizedWebhookEvent 반환
   * 2. CC-5 — 구독 생명주기 이벤트면 ProcessSubscriptionWebhookUseCase 로 라우팅 분기
   * 3. eventId 멱등성 게이트: webhookEventRepo.findByEventId — 이미 박제 시 즉시 skip
   * 4. tradeNo로 Payment 조회 + 약식 게이트(already_completed)
   * 5. completePaymentWithPoints (성공 — CC-2a 충전 포인트 적립) / refund (취소) / updateStatus (실패)
   * 6. webhookEventRepo.createIfAbsent — race 차단 (P2002 → null로 안전 skip)
   */
  async processWebhook(
    rawBody: Buffer | string,
    headers: Record<string, string>,
  ): Promise<{
    processed: boolean
    credits?: number
    deficitCredits?: number
    reason?: string
  }> {
    // F-13 — 무효(서명검증 실패/파싱 불가/eventId 누락)는 어댑터가 WebhookVerificationFailedError
    // throw → 컨트롤러가 400 매핑. 여기서 null 은 "정상이나 처리 대상 아닌 이벤트"(무시=2xx ack)뿐.
    const event = this.paymentGateway.verifyAndParseWebhook(rawBody, headers)
    if (!event) return { processed: false, reason: 'ignored' }

    // CC-5 (PAY-P1-4) — 구독 생명주기 이벤트는 구독 webhook usecase 로 라우팅.
    if (isSubscriptionEvent(event)) {
      if (!this.subscriptionWebhookUseCase) {
        this.logger.warn(
          `구독 webhook 수신 (${event.type}) — ProcessSubscriptionWebhookUseCase 미주입, ignored`,
        )
        return { processed: false, reason: 'subscription_handler_unavailable' }
      }
      const result = await this.subscriptionWebhookUseCase.execute(event)
      return { processed: result.processed, reason: result.reason }
    }

    return await this.processNormalizedWebhook(event)
  }

  /**
   * NormalizedWebhookEvent 직접 처리 — PAY-P2-2 WebhookRetryJob에서 재처리 시 호출.
   * verify 단계는 이미 첫 진입 시 통과했으므로 우회.
   */
  async processNormalizedWebhook(
    event: import('@domain/port/outbound/payment-gateway.port').NormalizedWebhookEvent,
  ): Promise<{
    processed: boolean
    credits?: number
    deficitCredits?: number
    reason?: string
  }> {
    // 1차 게이트: eventId 멱등성 — DB에 이미 박제된 event는 즉시 skip (completePaymentWithPoints 0회)
    const existing = await this.webhookEventRepo.findByEventId(event.eventId)
    if (existing && existing.status === 'processed') {
      this.logger.warn(`중복 webhook 감지 (eventId=${event.eventId}, status=processed) — skip`)
      return { processed: false, reason: 'duplicate_event' }
    }

    const payment = await this.paymentRepo.findByExternalTransactionId(event.tradeNo)
    if (!payment) {
      // unknown_trade여도 webhook event 박제 (재전송 시 동일 응답 보장)
      await this.webhookEventRepo.createIfAbsent({
        eventId: event.eventId,
        source: 'polar',
        eventType: event.type,
        payload: event as unknown as object,
        status: 'skipped',
        errorMessage: 'unknown_trade',
      })
      return { processed: false, reason: 'unknown_trade' }
    }
    if (payment.status === PAYMENT_STATUS.COMPLETED) {
      // 약식 게이트 (이전 webhook 박제 누락된 PROD 데이터 안전망)
      await this.webhookEventRepo.createIfAbsent({
        eventId: event.eventId,
        source: 'polar',
        eventType: event.type,
        payload: event as unknown as object,
        status: 'skipped',
        errorMessage: 'already_completed',
      })
      return { processed: false, reason: 'already_completed' }
    }
    // PAY-P3-A 구멍-A 차단: payment.status='refunded' 또는 'partial_refunded' 사전 게이트
    // (이미 환불 완료된 payment에 대한 재처리 방어 — 환불 후 재차감 0건 보장)
    // 정본: shared-contracts §22 PaymentRaceCondition + §28 PaymentStatusMapping (PAY-P3-D)
    // 도메인 helper 위임 — 환불 종료 어휘 통합 (refunded + partial_refunded REFUNDED_STATES 영역 정합)
    if (isPaymentAlreadyRefunded(payment.status)) {
      const reasonKey = `already_${payment.status}` as 'already_refunded' | 'already_partial_refunded'
      this.logger.warn(
        `[PaymentRaceCondition] ${reasonKey} eventId=${event.eventId} paymentId=${payment.id}`,
      )
      await this.webhookEventRepo.createIfAbsent({
        eventId: event.eventId,
        source: 'polar',
        eventType: event.type,
        payload: event as unknown as object,
        status: 'skipped',
        errorMessage: reasonKey,
      })
      return { processed: false, reason: reasonKey }
    }

    if (event.status === NORMALIZED_WEBHOOK_STATUS.SUCCESS) {
      // PAY-P2-4: 트랜잭션 진입 직전 잔액 조회 (beforeState 박제용)
      // authorRepo Optional — 미주입 시 박제 skip (회귀 보존)
      // CC-2a: 충전 적립이 신 포인트 원장으로 이행 — beforeState 는 충전 출처 캐시(pointsCharged).
      let balanceBefore: number | null = null
      if (this.authorRepo) {
        try {
          const author = await this.authorRepo.findById(payment.authorId)
          balanceBefore = author?.pointsCharged ?? null
        } catch (e: unknown) {
          // 잔액 조회 실패는 트랜잭션 진행을 막지 않음 — auditLog 박제만 skip
          this.logger.warn(
            `잔액 사전 조회 실패 (authorId=${payment.authorId}, paymentId=${payment.id}): ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }
      }

      // CC-2a (T3 충전 연동 — 진단 §1-A / §6-2) — 충전 success 경로를 신 포인트 원장으로 재배선.
      // completePaymentWithPoints 단일 $transaction 이 (Payment 완료 + deficit 우선 상계
      // + 충전 적립)을 원자 처리한다. settleDeficit 가 처음으로 실 충전 경로에 연결되어
      // C-6(충전해도 deficit 미상계 → 채팅 영구 차단) 해소.
      // [CC-4 Phase 2 rename] payment.points = 충전 총 pt (initiatePayment 에서 product.points 저장, 구 credits 컬럼).
      let chargeResult: { settledDeficit: number; chargedPoints: number; alreadyCompleted: boolean }
      try {
        chargeResult = await this.paymentRepo.completePaymentWithPoints(
          payment.id,
          payment.authorId,
          payment.points,
          payment.productId,
          payment.id,
        )
      } catch (e: unknown) {
        // PAY-P3-B 구멍-C 차단: SDK exception 분류 후 분기 처리
        // 정본: shared-contracts §24 PolarSDKTimeoutPolicy
        // - client_4xx → permanent_failed 즉시 박제 (retry queue 0건)
        // - 외 4분류 → retry queue 박제 (기존 PAY-P2-2 DLQ 흐름)
        const polarError = await this.classifyAndRouteWebhookError(
          e,
          event,
          payment.id,
          'success',
        )
        await this.webhookEventRepo.createIfAbsent({
          eventId: event.eventId,
          source: 'polar',
          eventType: event.type,
          payload: event as unknown as object,
          status: 'failed',
          errorMessage: `polar_${polarError.errorClass}: ${polarError.message.slice(0, 480)}`,
        })
        throw e
      }

      // R1-notify 잔여갭 (2026-06-28) — 동시성 패자 멱등 분기.
      // 서로 다른 Polar 이벤트(order.paid/order.updated/checkout.updated)가 eventId 가 달라
      // eventId 게이트(L305)와 약식 status 게이트(L325 TOCTOU)를 둘 다 통과해 동시에
      // completePaymentWithPoints 로 진입할 수 있다. status CAS 가 적립 이중화(돈)는 이미
      // 닫았으나(R1), 패자도 아래 ① payment_completed AuditLog ② notifyChargeSuccess
      // ③ { processed:true } 응답을 그대로 수행해 "성공 알림 2통 + 응답 비멱등"이 남아 있었다.
      // alreadyCompleted=true(패자)면 알림·성공 박제를 건너뛰고 L325 약식 게이트와 동일한
      // 멱등 응답(skipped/already_completed → { processed:false })을 반환한다(순차=동시 멱등 통일).
      if (chargeResult.alreadyCompleted) {
        this.logger.warn(
          `[PaymentRaceCondition] 충전 success 동시성 패자 (eventId=${event.eventId} ` +
            `paymentId=${payment.id}) — 이미 다른 트랜잭션이 완료. 알림 skip + 멱등 응답.`,
        )
        await this.webhookEventRepo.createIfAbsent({
          eventId: event.eventId,
          source: 'polar',
          eventType: event.type,
          payload: event as unknown as object,
          status: 'skipped',
          errorMessage: 'already_completed',
        })
        return { processed: false, reason: 'already_completed' }
      }

      // PAY-P2-4: payment_completed audit log 박제 (트랜잭션 외 후행)
      // 실패 시 logger.warn만, throw 0 — 결제 트랜잭션은 이미 commit됨.
      // CC-2a: 디노미 정합 — beforeState/afterState 는 충전 출처 캐시(pointsCharged) pt 기준.
      // chargedPoints(실제 적립분) = 충전 총 pt − 외상 상계분이므로 afterState 는
      // balanceBefore + chargeResult.chargedPoints (상계분은 charged 캐시로 적립되지 않음).
      // settledDeficit/chargedPoints 를 메타에 박제해 외상 상계 회계를 감사 추적.
      if (this.auditLog && balanceBefore !== null) {
        try {
          const chargedAfter = balanceBefore + chargeResult.chargedPoints
          await this.auditLog.log(
            'system_payment',
            'payment_completed',
            payment.id,
            {
              reason: `polar_webhook_${event.type}`,
              externalTransactionId: payment.externalTransactionId ?? event.tradeNo,
            },
            { pointsCharged: balanceBefore },
            {
              pointsCharged: chargedAfter,
              paymentId: payment.id,
              totalPoints: payment.points,
              chargedPoints: chargeResult.chargedPoints,
              settledDeficit: chargeResult.settledDeficit,
            },
          )
        } catch (e: unknown) {
          this.logger.warn(
            `AuditLog 박제 실패 (success, paymentId=${payment.id}): ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }
      }

      // 성공 박제 — race 시 (다른 worker가 먼저 INSERT) null 반환되어도 무시 (둘 다 같은 결과)
      const created = await this.webhookEventRepo.createIfAbsent({
        eventId: event.eventId,
        source: 'polar',
        eventType: event.type,
        payload: event as unknown as object,
        status: WEBHOOK_EVENT_STATUS.PROCESSED,
      })
      if (!created) {
        this.logger.warn(
          `webhook event race detected (eventId=${event.eventId}) — completePaymentWithPoints already executed`,
        )
      }
      // EMAIL-POLAR-READY Phase D (2026-05-27) — 결제 성공 알림 호출.
      // CLAUDE.md §9 결제 트랜잭션 원자성 정합 — $transaction 외부 + try/catch.
      // 알림 실패는 logger.warn만, throw 0 (결제 commit 보존).
      // NullAdapter (default) 시 isEnabled=false → 호출 0건.
      if (this.notificationUseCase) {
        try {
          await this.notificationUseCase.notifyChargeSuccess({
            paymentId: payment.id,
            authorId: payment.authorId,
            amount: event.amount,
            credits: payment.points,
          })
        } catch (e: unknown) {
          this.logger.warn(
            `결제 성공 알림 실패 (paymentId=${payment.id}): ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }
      }

      // 응답 키 `credits` 보존 (외부 호환성, webhook 응답 schema 안정). 내부 컬럼은 payment.points.
      return { processed: true, credits: payment.points }
    } else if (event.status === NORMALIZED_WEBHOOK_STATUS.CANCEL) {
      // CC-2b (2026-05-20, 진단 §1-C) — 환불 신 경로 + 이중 외상 통합.
      // refund-payment.usecase 가 paymentRepo.refundPaymentWithPoints $transaction 호출.
      // 4 출처 환수(charged→gift→subscription→free 우선) + 부족분 Author.deficitPoints 가산
      // → 외상 정본 단일화 + CC-2a `completePaymentWithPoints` 가 다음 충전 시 자동 회수.
      // [CC-4 Phase 2 rename] payment.points = 충전 총 pt → refundPt 로 그대로 전달
      let deficitIncurred = 0
      try {
        const result = await this.refundPaymentUseCase.execute({
          paymentId: payment.id,
          authorId: payment.authorId,
          refundPt: payment.points,
          refundedAmount: event.amount,
          reason: `polar_webhook_${event.type}`,
          source: 'webhook',
        })
        deficitIncurred = result.deficitIncurred
      } catch (e: unknown) {
        // PAY-P3-B 구멍-C 차단: SDK exception 분류 후 분기 처리 (cancel 분기)
        // 정본: shared-contracts §24 PolarSDKTimeoutPolicy
        // - client_4xx → permanent_failed 즉시 박제 (retry queue 0건)
        // - 외 4분류 → retry queue 박제 (기존 PAY-P2-2 DLQ 흐름)
        const polarError = await this.classifyAndRouteWebhookError(
          e,
          event,
          payment.id,
          'cancel',
        )
        await this.webhookEventRepo.createIfAbsent({
          eventId: event.eventId,
          source: 'polar',
          eventType: event.type,
          payload: event as unknown as object,
          status: 'failed',
          errorMessage: `polar_${polarError.errorClass}: ${polarError.message.slice(0, 480)}`,
        })
        throw e
      }

      await this.webhookEventRepo.createIfAbsent({
        eventId: event.eventId,
        source: 'polar',
        eventType: event.type,
        payload: event as unknown as object,
        status: 'processed',
      })

      // EMAIL-POLAR-READY Phase D (2026-05-27) — 환불 완료 알림 호출.
      // $transaction 외부 + try/catch (결제 trigger 부분환불도 commit 보존).
      if (this.notificationUseCase) {
        try {
          await this.notificationUseCase.notifyRefundProcessed({
            paymentId: payment.id,
            authorId: payment.authorId,
            refundedAmount: event.amount,
            actualRefunded: payment.points - deficitIncurred,
            deficitIncurred,
            isPartial: event.amount < payment.amount,
            reason: `polar_webhook_${event.type}`,
          })
        } catch (e: unknown) {
          this.logger.warn(
            `환불 완료 알림 실패 (paymentId=${payment.id}): ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }
      }

      return { processed: true, credits: 0, deficitCredits: deficitIncurred }
    } else {
      // event.status === 'fail' — 결제 실패 (크레딧 환수 대상 아님 — pending → failed만)
      await this.paymentRepo.updateStatus(payment.id, 'failed')
      await this.webhookEventRepo.createIfAbsent({
        eventId: event.eventId,
        source: 'polar',
        eventType: event.type,
        payload: event as unknown as object,
        status: 'processed',
      })

      // EMAIL-POLAR-READY Phase D (2026-05-27) — 결제 실패 알림 호출.
      // $transaction 외부 + try/catch.
      if (this.notificationUseCase) {
        try {
          await this.notificationUseCase.notifyChargeFailed({
            paymentId: payment.id,
            authorId: payment.authorId,
            amount: event.amount,
          })
        } catch (e: unknown) {
          this.logger.warn(
            `결제 실패 알림 실패 (paymentId=${payment.id}): ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }
      }

      return { processed: true, credits: 0 }
    }
  }

  /** 결제 내역 조회 */
  async getPaymentHistory(authorId: string) {
    return this.paymentRepo.findByAuthorId(authorId)
  }
}
