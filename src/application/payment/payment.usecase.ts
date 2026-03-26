import { Injectable, Inject, BadRequestException } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { PaymentGatewayPort, WebhookPayload } from '@domain/port/outbound/payment-gateway.port'

/**
 * 크레딧 상품 카탈로그
 *
 * 크레딧 단가 계산 (절대 원칙: AI 비용 < 크레딧 수익)
 * Claude Sonnet: ~$3/1M input, ~$15/1M output ≈ 약 4000원/1M tokens
 * 테마 생성 1회 ≈ 2000 tokens ≈ 약 12원
 * 1 크레딧 = 100원 (최소 마진 8배)
 */
export const CREDIT_PRODUCTS = [
  { id: 'credit-10', name: '10 크레딧', credits: 10, price: 1000 },    // 크레딧당 100원
  { id: 'credit-30', name: '30 크레딧', credits: 30, price: 2500 },    // 크레딧당 83원 (17% 할인)
  { id: 'credit-100', name: '100 크레딧', credits: 100, price: 7000 }, // 크레딧당 70원 (30% 할인)
] as const

export type Product = (typeof CREDIT_PRODUCTS)[number]

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

    // PAYAPP 결제 요청
    const result = await this.paymentGateway.initiatePayment({
      productId: product.id,
      productName: product.name,
      amount: product.price,
      userId: authorId,
      returnUrl,
    })

    // tradeNo 업데이트
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { payappTradeNo: result.tradeNo },
    })

    return {
      paymentId: payment.id,
      paymentUrl: result.paymentUrl,
      tradeNo: result.tradeNo,
    }
  }

  /** 웹훅 처리 — 서명 검증 + 크레딧 부여 */
  async processWebhook(payload: WebhookPayload) {
    // 서명 검증
    const secret = process.env.PAYAPP_SECRET || ''
    const valid = this.paymentGateway.verifyWebhookSignature(payload, secret)
    if (!valid) {
      throw new BadRequestException('웹훅 서명 검증 실패')
    }

    // tradeNo로 Payment 조회
    const payment = await this.prisma.payment.findUnique({
      where: { payappTradeNo: payload.tradeNo },
    })

    // 결제 레코드 없으면 무시 (멱등성)
    if (!payment) {
      return { processed: false, reason: 'unknown_trade' }
    }

    // 이미 완료된 결제는 무시 (중복 웹훅 방지)
    if (payment.status === 'completed') {
      return { processed: false, reason: 'already_completed' }
    }

    if (payload.status === 'success') {
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
        data: { status: 'failed' },
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
