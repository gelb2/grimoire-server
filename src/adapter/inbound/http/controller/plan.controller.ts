import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { PlanUseCase } from '@application/plan/plan.usecase'

@Controller('plan')
export class PlanController {
  constructor(private readonly planUseCase: PlanUseCase) {}

  /** 내 플랜 정보 조회 */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getPlanInfo(@Req() req: AuthenticatedRequest) {
    return this.planUseCase.getPlanInfo(req.user.sub)
  }
}
