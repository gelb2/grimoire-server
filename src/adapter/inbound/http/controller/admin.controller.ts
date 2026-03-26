import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AdminUseCase } from '@application/admin/admin.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { AdminGuard } from '@adapter/inbound/http/guard/admin.guard'

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminUseCase: AdminUseCase) {}

  /** 플랫폼 통계 (관리자 전용) */
  @Get('stats')
  async getStats() {
    return this.adminUseCase.getStats()
  }

  /** 크레딧 부여 (관리자 전용) */
  @Throttle({ default: { ttl: 60000, limit: 5 } })  // 분당 5회
  @Post('credits')
  async grantCredits(@Body() body: { authorId: string; amount: number; reason: string }) {
    return this.adminUseCase.grantCredits(body.authorId, body.amount, body.reason)
  }
}
