import { Controller, Post, Patch, Delete, Body, Param, UseGuards, Req } from '@nestjs/common'
import { WorkManagementUseCase } from '@application/work/work-management.usecase'
import { CreateWorkDto, UpdateWorkDto, CreateEpisodeDto } from '@adapter/inbound/http/dto/work.dto'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('works')
@UseGuards(JwtAuthGuard)
export class WorkManagementController {
  constructor(private readonly workManagementUseCase: WorkManagementUseCase) {}

  @Post()
  async createWork(@Req() req: any, @Body() dto: CreateWorkDto) {
    return this.workManagementUseCase.createWork(req.user.sub, dto)
  }

  @Patch(':id')
  async updateWork(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateWorkDto) {
    return this.workManagementUseCase.updateWork(req.user.sub, id, dto)
  }

  @Delete(':id')
  async deleteWork(@Req() req: any, @Param('id') id: string) {
    await this.workManagementUseCase.deleteWork(req.user.sub, id)
    return { deleted: true }
  }

  @Post(':workId/episodes')
  async createEpisode(@Req() req: any, @Param('workId') workId: string, @Body() dto: CreateEpisodeDto) {
    return this.workManagementUseCase.createEpisode(req.user.sub, workId, dto)
  }
}

@Controller('episodes')
@UseGuards(JwtAuthGuard)
export class EpisodeManagementController {
  constructor(private readonly workManagementUseCase: WorkManagementUseCase) {}

  @Delete(':id')
  async deleteEpisode(@Req() req: any, @Param('id') id: string) {
    await this.workManagementUseCase.deleteEpisode(req.user.sub, id)
    return { deleted: true }
  }
}
