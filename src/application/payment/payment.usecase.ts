import { Injectable, BadRequestException } from '@nestjs/common'
import { CreditUseCase } from '@application/credit/credit.usecase'

// 크레딧 상품 정의
const CREDIT_PRODUCTS = {
  credit_5: { credits: 5, priceKrw: 1000 },
  credit_20: { credits: 20, priceKrw: 3000 },
  credit_50: { credits: 50, priceKrw: 5000 },
} as const

export type ProductId = keyof typeof CREDIT_PRODUCTS

@Injectable()
export class PaymentUseCase {
  constructor(
    private readonly creditUseCase: CreditUseCase,
  ) {}

  /** 상품 목록 조회 */
  getProducts() {
    return Object.entries(CREDIT_PRODUCTS).map(([id, product]) => ({
      id,
      credits: product.credits,
      priceKrw: product.priceKrw,
      pricePerCredit: Math.round(product.priceKrw / product.credits),
    }))
  }

  /** 결제 웹훅 처리 */
  async processWebhook(data: { paymentId: string; productId: string; authorId: string; status: string }) {
    if (data.status !== 'completed') return { processed: false }

    const product = CREDIT_PRODUCTS[data.productId as ProductId]
    if (!product) throw new BadRequestException('알 수 없는 상품입니다')

    // 크레딧 부여
    const result = await this.creditUseCase.grant(
      data.authorId,
      product.credits,
      `purchase_${data.productId}_${data.paymentId}`,
    )

    return { processed: true, credits: result.credits }
  }
}
