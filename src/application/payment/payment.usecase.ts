import { Injectable, Inject, BadRequestException } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { PaymentGatewayPort } from '@domain/port/outbound/payment-gateway.port'

/**
 * 크레딧 상품 카탈로그 — PLANNING_GRIMOIRE.md §8 기준
 *
 * 크레딧 단가 계산 (절대 원칙: AI 비용 < 크레딧 수익)
 * 베스트 패키지 기준: 50 크레딧 / ₩5,000 → 개당 ₩100 → 마진 82.5%
 */
import { CREDIT_PRODUCTS, Product } from '@domain/model/config'

// re-export for backward compatibility
export { CREDIT_PRODUCTS, type Product }

@Injectable()
export class PaymentUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditUseCase: CreditUseCase,
    @Inject('PaymentGatewayPort') private readonly paymentGateway: PaymentGatewayPort,
  ) {}

  /** 상품 목록 조회 */
  getProducts() {
    return CREDIT_PRODUCTS.map((p) => ({
      id: p.id,
      name: p.name,
      credits: p.credits,
      price: p.price,
      pricePerCredit: Math.round(p.price / p.credits),
    }))
  }

  /** 결제 시작 — Payment 레코드 생성 + 게이트웨이 호출 */
  async initiatePayment(authorId: string, productId: string, returnUrl: string) {
    // 상품 유효성 검증
    const product = CREDIT_PRODUCTS.find((p) => p.id === productId)
    if (!product) {
      throw new BadRequestException(`존재하지 않는 상품입니다: ${productId}`)
    }

    // Payment 레코드 생성 (pending 상태)
    const payment = await this.prisma.payment.create({
      data: {
        authorId,
        productId: product.id,
        amount: product.price,
        credits: product.credits,
        status: 'pending',
      },
    })

    // 결제 게이트웨이 호출
    const result = await this.paymentGateway.initiatePayment({
      productId: product.id,
      productName: product.name,
      amount: product.price,
      userId: authorId,
      returnUrl,
    })

    // 외부 거래 ID 업데이트
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { externalTransactionId: result.tradeNo },
    })

    return {
      paymentId: payment.id,
      paymentUrl: result.paymentUrl,
      tradeNo: result.tradeNo,
    }
  }

  /** 웹훅 처리 — 서명 검증 + 크레딧 부여 (raw body + headers) */
  async processWebhook(rawBody: Buffer | string, headers: Record<string, string>) {
    // 어댑터가 서명 검증 + 파싱 + 정규화까지 수행
    const event = this.paymentGateway.verifyAndParseWebhook(rawBody, headers)
    if (!event) {
      // 서명 검증 실패 또는 처리 대상이 아닌 이벤트
      return { processed: false, reason: 'invalid_or_ignored' }
    }

    // 외부 거래 ID로 Payment 조회
    const payment = await this.prisma.payment.findUnique({
      where: { externalTransactionId: event.tradeNo },
    })

    // 결제 레코드 없으면 무시 (멱등성)
    if (!payment) {
      return { processed: false, reason: 'unknown_trade' }
    }

    // 이미 완료된 결제는 무시 (중복 웹훅 방지)
    if (payment.status === 'completed') {
      return { processed: false, reason: 'already_completed' }
    }

    if (event.status === 'success') {
      // 결제 성공: Payment 상태 + 크레딧 부여를 단일 트랜잭션으로 원자 처리
      // → 둘 중 하나라도 실패하면 전부 롤백 (돈 냈는데 크레딧 안 들어오는 사고 방지)
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'completed', completedAt: new Date() },
        })

        const author = await tx.author.update({
          where: { id: payment.authorId },
          data: { credits: { increment: payment.credits } },
        })

        // 크레딧 로그 기록
        await tx.creditLog.create({
          data: {
            authorId: payment.authorId,
            amount: payment.credits,
            reason: `purchase_${payment.productId}_${payment.id}`,
          },
        })
      })

      return { processed: true, credits: payment.credits }
    } else {
      // 결제 실패/취소: 상태 업데이트만
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: event.status === 'cancel' ? 'refunded' : 'failed' },
      })

      return { processed: true, credits: 0 }
    }
  }

  /** 결제 내역 조회 */
  async getPaymentHistory(authorId: string) {
    return this.prisma.payment.findMany({
      where: { authorId },
      orderBy: { createdAt: 'desc' },
    })
  }
}
