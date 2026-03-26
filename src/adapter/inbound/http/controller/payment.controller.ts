import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common'
import { PaymentUseCase } from '@application/payment/payment.usecase'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { WebhookPayload } from '@domain/port/outbound/payment-gateway.port'

@Controller('payments')
export class PaymentController {
  constructor(
    private readonly paymentUseCase: PaymentUseCase,
    private readonly creditUseCase: CreditUseCase,
  ) {}

  /** 상품 목록 조회 (공개) */
  @Get('products')
  getProducts() {
    return this.paymentUseCase.getProducts()
  }

  /** 결제 시작 (인증 필요) */
  @UseGuards(JwtAuthGuard)
  @Post('initiate')
  async initiatePayment(@Req() req: any, @Body() body: { productId: string; returnUrl: string }) {
    return this.paymentUseCase.initiatePayment(req.user.sub, body.productId, body.returnUrl)
  }

  /** PAYAPP 웹훅 콜백 (공개, 서명 검증) */
  @Post('webhook')
  async webhook(@Body() body: WebhookPayload) {
    return this.paymentUseCase.processWebhook(body)
  }

  /** 결제 내역 조회 (인증 필요) */
  @UseGuards(JwtAuthGuard)
  @Get('history')
  async getHistory(@Req() req: any) {
    return this.paymentUseCase.getPaymentHistory(req.user.sub)
  }

  /** 크레딧 잔액 조회 (인증 필요) */
  @UseGuards(JwtAuthGuard)
  @Get('credits')
  async getCredits(@Req() req: any) {
    return { credits: await this.creditUseCase.getBalance(req.user.sub) }
  }
}
