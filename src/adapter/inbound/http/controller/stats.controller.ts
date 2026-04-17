import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common'
import { StatsUseCase } from '@application/stats/stats.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly statsUseCase: StatsUseCase) {}

  /** 작품 조회수 통계 (소유자만)
   * ContentController의 GET /works/:authorSlug/:workSlug 와 라우트 shadowing
   * 충돌을 피하기 위해 /stats 접두어를 사용한다.
   */
  @Get('works/:workId')
  async getWorkStats(@Req() req: AuthenticatedRequest, @Param('workId') workId: string) {
    return this.statsUseCase.getWorkStats(req.user.sub, workId)
  }
}
