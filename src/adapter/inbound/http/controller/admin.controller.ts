import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AdminUseCase } from '@application/admin/admin.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { AdminGuard } from '@adapter/inbound/http/guard/admin.guard'

interface AuthenticatedRequest {
  user: { sub: string; slug: string; role: string }
}

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminUseCase: AdminUseCase) {}

  // ─── 통계 ───

  @Get('stats')
  async getStats() {
    return this.adminUseCase.getStats()
  }

  // ─── 사용자 관리 ───

  @Get('authors')
  async listAuthors(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') query?: string,
  ) {
    return this.adminUseCase.listAuthors({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      query,
    })
  }

  @Get('authors/:authorId')
  async getAuthor(@Param('authorId') authorId: string) {
    return this.adminUseCase.getAuthor(authorId)
  }

  @Post('authors')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async createAuthor(
    @Req() req: AuthenticatedRequest,
    @Body() body: { email: string; name: string; slug: string; password: string; plan?: string },
  ) {
    return this.adminUseCase.createAuthor(req.user.sub, body)
  }

  @Patch('authors/:authorId')
  async updateAuthor(
    @Req() req: AuthenticatedRequest,
    @Param('authorId') authorId: string,
    @Body() body: { name?: string; bio?: string },
  ) {
    return this.adminUseCase.updateAuthor(req.user.sub, authorId, body)
  }

  @Delete('authors/:authorId')
  async deleteAuthor(
    @Req() req: AuthenticatedRequest,
    @Param('authorId') authorId: string,
  ) {
    await this.adminUseCase.deleteAuthor(req.user.sub, authorId)
    return { deleted: true }
  }

  @Patch('authors/:authorId/role')
  async changeRole(
    @Req() req: AuthenticatedRequest,
    @Param('authorId') authorId: string,
    @Body() body: { role: string },
  ) {
    return this.adminUseCase.changeRole(req.user.sub, authorId, body.role)
  }

  // ─── 크레딧 관리 ───

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('credits/grant')
  async grantCredits(
    @Req() req: AuthenticatedRequest,
    @Body() body: { authorId: string; amount: number; reason: string },
  ) {
    return this.adminUseCase.grantCredits(req.user.sub, body.authorId, body.amount, body.reason)
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('credits/deduct')
  async deductCredits(
    @Req() req: AuthenticatedRequest,
    @Body() body: { authorId: string; amount: number; reason: string },
  ) {
    return this.adminUseCase.deductCredits(req.user.sub, body.authorId, body.amount, body.reason)
  }

  @Get('credits/logs')
  async getCreditLogs(@Query('authorId') authorId?: string) {
    return this.adminUseCase.getAllCreditLogs(authorId)
  }

  // ─── 플랜 관리 ───

  @Patch('authors/:authorId/plan')
  async changePlan(
    @Req() req: AuthenticatedRequest,
    @Param('authorId') authorId: string,
    @Body() body: { plan: string; durationDays: number },
  ) {
    await this.adminUseCase.changePlan(req.user.sub, authorId, body.plan, body.durationDays)
    return { success: true }
  }

  // ─── 감사 로그 ───

  @Get('audit-logs')
  async getAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
  ) {
    return this.adminUseCase.getAuditLogs({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      action,
    })
  }
}
