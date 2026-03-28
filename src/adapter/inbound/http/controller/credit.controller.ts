import { Controller, Get, Post, Body, UseGuards, Req, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('credits')
export class CreditController {
  constructor(private readonly creditUseCase: CreditUseCase) {}

  /** 크레딧 선물 (독자 → 작가) */
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UseGuards(JwtAuthGuard)
  @Post('gift')
  async gift(@Req() req: any, @Body() body: { receiverId: string; amount: number }) {
    return this.creditUseCase.gift(req.user.sub, body.receiverId, body.amount)
  }

  /** 응원받는 작가 랭킹 (공개) */
  @Get('ranking')
  async getGiftRanking(@Query('limit') limit?: string) {
    return this.creditUseCase.getGiftRanking(limit ? parseInt(limit, 10) : 10)
  }

  /** 크레딧 잔액 조회 */
  @UseGuards(JwtAuthGuard)
  @Get('balance')
  async getBalance(@Req() req: any) {
    return { credits: await this.creditUseCase.getBalance(req.user.sub) }
  }

  /** 크레딧 로그 조회 */
  @UseGuards(JwtAuthGuard)
  @Get('logs')
  async getLogs(@Req() req: any) {
    return this.creditUseCase.getLogs(req.user.sub)
  }
}
