import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Get, Post, Body, UseGuards, Req, Headers } from '@nestjs/common'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import { PaymentUseCase } from '@application/payment/payment.usecase'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import type { Request } from 'express'

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
  @Throttle({ default: { ttl: 60000, limit: 3 } })  // 분당 3회
  @UseGuards(JwtAuthGuard)
  @Post('initiate')
  async initiatePayment(@Req() req: AuthenticatedRequest, @Body() body: { productId: string; returnUrl: string }) {
    return this.paymentUseCase.initiatePayment(req.user.sub, body.productId, body.returnUrl)
  }

  /**
   * Polar 웹훅 콜백 (공개, 서명 검증)
   * - main.ts에서 이 라우트에 raw body 파싱이 적용됨 (req.body = Buffer)
   * - Standard Webhooks 스펙: webhook-id / webhook-timestamp / webhook-signature 헤더
   */
  @SkipThrottle()
  @Post('webhook')
  async webhook(@Req() req: Request, @Headers() headers: Record<string, string>) {
    const rawBody = (req as Request & { body: Buffer }).body
    return this.paymentUseCase.processWebhook(rawBody, headers)
  }

  /** 결제 내역 조회 (인증 필요) */
  @UseGuards(JwtAuthGuard)
  @Get('history')
  async getHistory(@Req() req: AuthenticatedRequest) {
    return this.paymentUseCase.getPaymentHistory(req.user.sub)
  }

  /** 크레딧 잔액 조회 (인증 필요) */
  @UseGuards(JwtAuthGuard)
  @Get('credits')
  async getCredits(@Req() req: AuthenticatedRequest) {
    return { credits: await this.creditUseCase.getBalance(req.user.sub) }
  }
}
