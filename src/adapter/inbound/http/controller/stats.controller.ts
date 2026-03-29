import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common'
import { StatsUseCase } from '@application/stats/stats.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('works')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly statsUseCase: StatsUseCase) {}

  /** 작품 조회수 통계 (소유자만) */
  @Get(':workId/stats')
  async getWorkStats(@Req() req: AuthenticatedRequest, @Param('workId') workId: string) {
    return this.statsUseCase.getWorkStats(req.user.sub, workId)
  }
}
