import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common'
import { PaymentRepositoryPort } from '@domain/port/outbound/payment-repository.port'
import { PaymentGatewayPort } from '@domain/port/outbound/payment-gateway.port'
import { WebhookEventRepositoryPort } from '@domain/port/outbound/webhook-event-repository.port'
import { CREDIT_PRODUCTS, Product } from '@domain/model/config'
import { RefundPaymentUseCase } from './refund-payment.usecase'

// re-export for backward compatibility
export { CREDIT_PRODUCTS, type Product }

@Injectable()
export class PaymentUseCase {
  private readonly logger = new Logger(PaymentUseCase.name)

  constructor(
    @Inject('PaymentRepositoryPort') private readonly paymentRepo: PaymentRepositoryPort,
    @Inject('PaymentGatewayPort') private readonly paymentGateway: PaymentGatewayPort,
    @Inject('WebhookEventRepositoryPort') private readonly webhookEventRepo: WebhookEventRepositoryPort,
    private readonly refundPaymentUseCase: RefundPaymentUseCase,
  ) {}

  /** 상품 목록 조회 */
  getProducts() {
    return CREDIT_PRODUCTS.map((p) => ({
      id: p.id, name: p.name, credits: p.credits, price: p.price,
      pricePerCredit: Math.round(p.price / p.credits),
    }))
  }

  /** 결제 시작 — Payment 레코드 생성 + 게이트웨이 호출 */
  async initiatePayment(authorId: string, productId: string, returnUrl: string) {
    const product = CREDIT_PRODUCTS.find((p) => p.id === productId)
    if (!product) throw new BadRequestException(`존재하지 않는 상품입니다: ${productId}`)

    const payment = await this.paymentRepo.create({
      authorId, productId: product.id, amount: product.price, credits: product.credits,
    })

    const result = await this.paymentGateway.initiatePayment({
      productId: product.id, productName: product.name, amount: product.price, userId: authorId, returnUrl,
    })

    await this.paymentRepo.updateExternalTransactionId(payment.id, result.tradeNo)

    return { paymentId: payment.id, paymentUrl: result.paymentUrl, tradeNo: result.tradeNo }
  }

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
  async processWebhook(rawBody: Buffer | string, headers: Record<string, string>) {
    const event = this.paymentGateway.verifyAndParseWebhook(rawBody, headers)
    if (!event) return { processed: false, reason: 'invalid_or_ignored' }

    // 1차 게이트: eventId 멱등성 — DB에 이미 박제된 event는 즉시 skip (completePaymentAtomically 0회)
    const existing = await this.webhookEventRepo.findByEventId(event.eventId)
    if (existing) {
      this.logger.warn(`중복 webhook 감지 (eventId=${event.eventId}, status=${existing.status}) — skip`)
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

    if (event.status === 'success') {
      try {
        // 원자 처리: payment 상태 + 크레딧 증가 + 로그 기록 (단일 트랜잭션)
        await this.paymentRepo.completePaymentAtomically(payment.id, payment.authorId, payment.credits, payment.productId)
      } catch (e: unknown) {
        // 처리 중 오류 — webhook event를 'failed'로 박제 (Polar 재전송 시 다른 eventId로 다시 시도 가능)
        const message = e instanceof Error ? e.message : String(e)
        await this.webhookEventRepo.createIfAbsent({
          eventId: event.eventId,
          source: 'polar',
          eventType: event.type,
          payload: event as unknown as object,
          status: 'failed',
          errorMessage: message.slice(0, 500),
        })
        throw e
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
        // 환수 실패 — webhook event를 'failed'로 박제 (Polar 재전송 시 다른 eventId 시도)
        const message = e instanceof Error ? e.message : String(e)
        await this.webhookEventRepo.createIfAbsent({
          eventId: event.eventId,
          source: 'polar',
          eventType: event.type,
          payload: event as unknown as object,
          status: 'failed',
          errorMessage: message.slice(0, 500),
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
