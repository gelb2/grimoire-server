import { Injectable, Inject, BadRequestException, Logger, Optional } from '@nestjs/common'
import { PaymentRepositoryPort } from '@domain/port/outbound/payment-repository.port'
import { PaymentGatewayPort } from '@domain/port/outbound/payment-gateway.port'
import { WebhookEventRepositoryPort } from '@domain/port/outbound/webhook-event-repository.port'
import { WebhookRetryQueueRepositoryPort } from '@domain/port/outbound/webhook-retry-queue-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CREDIT_PRODUCTS, Product } from '@domain/model/config'
import { RefundPaymentUseCase } from './refund-payment.usecase'
import { AuditLogService } from '@application/admin/audit-log.service'

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

  /** 상품 목록 조회 */
  getProducts() {
    return CREDIT_PRODUCTS.map((p) => ({
      id: p.id, name: p.name, credits: p.credits, price: p.price,
      pricePerCredit: Math.round(p.price / p.credits),
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
      payment = await this.paymentRepo.create({
        authorId, productId: product.id, amount: product.price, credits: product.credits,
      })
    } else {
      this.logger.log(
        `[reuse] 24h 이내 pending 재사용 — paymentId=${payment.id} authorId=${authorId} productId=${product.id}`,
      )
    }

    const result = await this.paymentGateway.initiatePayment({
      productId: product.id, productName: product.name, amount: product.price, userId: authorId, returnUrl,
    })

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
   * 2. eventId 멱등성 게이트: webhookEventRepo.findByEventId — 이미 박제 시 즉시 skip
   * 3. tradeNo로 Payment 조회 + 약식 게이트(already_completed)
   * 4. completePaymentAtomically (성공) / updateStatus (실패/취소)
   * 5. webhookEventRepo.createIfAbsent — race 차단 (P2002 → null로 안전 skip)
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
    const event = this.paymentGateway.verifyAndParseWebhook(rawBody, headers)
    if (!event) return { processed: false, reason: 'invalid_or_ignored' }
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
    // 1차 게이트: eventId 멱등성 — DB에 이미 박제된 event는 즉시 skip (completePaymentAtomically 0회)
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
    if (payment.status === 'completed') {
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
    // 정본: shared-contracts §22 PaymentRaceCondition
    if (payment.status === 'refunded' || payment.status === 'partial_refunded') {
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

    if (event.status === 'success') {
      // PAY-P2-4: 트랜잭션 진입 직전 잔액 조회 (beforeState 박제용)
      // authorRepo Optional — 미주입 시 박제 skip (회귀 보존)
      let balanceBefore: number | null = null
      if (this.authorRepo) {
        try {
          const author = await this.authorRepo.findById(payment.authorId)
          balanceBefore = author?.credits ?? null
        } catch (e: unknown) {
          // 잔액 조회 실패는 트랜잭션 진행을 막지 않음 — auditLog 박제만 skip
          this.logger.warn(
            `잔액 사전 조회 실패 (authorId=${payment.authorId}, paymentId=${payment.id}): ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }
      }

      try {
        // 원자 처리: payment 상태 + 크레딧 증가 + 로그 기록 (단일 트랜잭션)
        await this.paymentRepo.completePaymentAtomically(payment.id, payment.authorId, payment.credits, payment.productId)
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

      // PAY-P2-4: payment_completed audit log 박제 (트랜잭션 외 후행)
      // 실패 시 logger.warn만, throw 0 — 결제 트랜잭션은 이미 commit됨.
      if (this.auditLog && balanceBefore !== null) {
        try {
          const balanceAfter = balanceBefore + payment.credits
          await this.auditLog.log(
            'system_payment',
            'payment_completed',
            payment.id,
            {
              reason: `polar_webhook_${event.type}`,
              externalTransactionId: payment.externalTransactionId ?? event.tradeNo,
            },
            { credits: balanceBefore },
            { credits: balanceAfter, paymentId: payment.id, addedCredits: payment.credits },
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
        status: 'processed',
      })
      if (!created) {
        this.logger.warn(
          `webhook event race detected (eventId=${event.eventId}) — completePaymentAtomically already executed`,
        )
      }
      return { processed: true, credits: payment.credits }
    } else if (event.status === 'cancel') {
      // 환불 처리 (Sprint PAY-P1-1) — 크레딧 환수 트랜잭션 + RefundLog + AuditLog(operator='system_refund')
      // refund-payment.usecase가 paymentRepo.refundPaymentAtomically $transaction 호출 (정본: shared-contracts §13)
      let deficitCredits = 0
      try {
        const result = await this.refundPaymentUseCase.execute({
          paymentId: payment.id,
          authorId: payment.authorId,
          credits: payment.credits,
          refundedAmount: event.amount,
          reason: `polar_webhook_${event.type}`,
          source: 'webhook',
        })
        deficitCredits = result.deficitCredits
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
      return { processed: true, credits: 0, deficitCredits }
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
      return { processed: true, credits: 0 }
    }
  }

  /** 결제 내역 조회 */
  async getPaymentHistory(authorId: string) {
    return this.paymentRepo.findByAuthorId(authorId)
  }
}
