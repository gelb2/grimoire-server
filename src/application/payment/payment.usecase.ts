import { Injectable, Inject, BadRequestException } from '@nestjs/common'
import { PaymentRepositoryPort } from '@domain/port/outbound/payment-repository.port'
import { PaymentGatewayPort } from '@domain/port/outbound/payment-gateway.port'
import { CREDIT_PRODUCTS, Product } from '@domain/model/config'

// re-export for backward compatibility
export { CREDIT_PRODUCTS, type Product }

@Injectable()
export class PaymentUseCase {
  constructor(
    @Inject('PaymentRepositoryPort') private readonly paymentRepo: PaymentRepositoryPort,
    @Inject('PaymentGatewayPort') private readonly paymentGateway: PaymentGatewayPort,
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

  /** 웹훅 처리 — 서명 검증 + 크레딧 부여 */
  async processWebhook(rawBody: Buffer | string, headers: Record<string, string>) {
    const event = this.paymentGateway.verifyAndParseWebhook(rawBody, headers)
    if (!event) return { processed: false, reason: 'invalid_or_ignored' }

    const payment = await this.paymentRepo.findByExternalTransactionId(event.tradeNo)
    if (!payment) return { processed: false, reason: 'unknown_trade' }
    if (payment.status === 'completed') return { processed: false, reason: 'already_completed' }

    if (event.status === 'success') {
      // 원자 처리: payment 상태 + 크레딧 증가 + 로그 기록 (단일 트랜잭션)
      await this.paymentRepo.completePaymentAtomically(payment.id, payment.authorId, payment.credits, payment.productId)
      return { processed: true, credits: payment.credits }
    } else {
      await this.paymentRepo.updateStatus(payment.id, event.status === 'cancel' ? 'refunded' : 'failed')
      return { processed: true, credits: 0 }
    }
  }

  /** 결제 내역 조회 */
  async getPaymentHistory(authorId: string) {
    return this.paymentRepo.findByAuthorId(authorId)
  }
}
