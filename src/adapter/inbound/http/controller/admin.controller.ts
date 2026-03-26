import { Controller, Get, Post, Body } from '@nestjs/common'
import { AdminUseCase } from '@application/admin/admin.usecase'

@Controller('admin')
export class AdminController {
  constructor(private readonly adminUseCase: AdminUseCase) {}

  /** 플랫폼 통계 (TODO: admin auth) */
  @Get('stats')
  async getStats() {
    return this.adminUseCase.getStats()
  }

  /** 크레딧 부여 (TODO: admin auth) */
  @Post('credits')
  async grantCredits(@Body() body: { authorId: string; amount: number; reason: string }) {
    return this.adminUseCase.grantCredits(body.authorId, body.amount, body.reason)
  }
}
