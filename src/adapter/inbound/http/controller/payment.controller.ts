import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common'
import { PaymentUseCase } from '@application/payment/payment.usecase'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('payments')
export class PaymentController {
  constructor(
    private readonly paymentUseCase: PaymentUseCase,
    private readonly creditUseCase: CreditUseCase,
  ) {}

  @Get('products')
  getProducts() {
    return this.paymentUseCase.getProducts()
  }

  @Post('webhook')
  async webhook(@Body() body: { paymentId: string; productId: string; authorId: string; status: string }) {
    // TODO: PAYAPP 서명 검증 추가 (Phase 3 후반)
    return this.paymentUseCase.processWebhook(body)
  }

  @UseGuards(JwtAuthGuard)
  @Get('credits')
  async getCredits(@Req() req: any) {
    return { credits: await this.creditUseCase.getBalance(req.user.sub) }
  }
}
