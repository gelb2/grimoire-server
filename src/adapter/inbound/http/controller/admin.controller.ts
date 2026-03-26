import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AdminUseCase } from '@application/admin/admin.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly adminUseCase: AdminUseCase) {}

  /** 플랫폼 통계 (TODO: role-based admin 권한 분리) */
  @Get('stats')
  async getStats() {
    return this.adminUseCase.getStats()
  }

  /** 크레딧 부여 (TODO: role-based admin 권한 분리) */
  @Throttle({ default: { ttl: 60000, limit: 5 } })  // 분당 5회
  @Post('credits')
  async grantCredits(@Body() body: { authorId: string; amount: number; reason: string }) {
    return this.adminUseCase.grantCredits(body.authorId, body.amount, body.reason)
  }
}
