import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, Res, UseGuards, UnauthorizedException } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Request, Response } from 'express'
import * as bcrypt from 'bcryptjs'
import { JwtService } from '@nestjs/jwt'
import { AdminUseCase } from '@application/admin/admin.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { AdminGuard } from '@adapter/inbound/http/guard/admin.guard'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { AccessLogService } from '@infrastructure/security/access-log.service'

interface AuthenticatedRequest {
  user: { sub: string; slug: string; role: string }
}

const COOKIE_NAME = 'grimoire_token'
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminUseCase: AdminUseCase,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly accessLog: AccessLogService,
  ) {}

  // ─── 관리자 전용 로그인 (reCAPTCHA 없음, role=admin 검증) ───

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  async adminLogin(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || undefined
    const userAgent = req.headers['user-agent'] || undefined

    const author = await this.prisma.author.findUnique({
      where: { email: body.email },
    })

    if (!author || !author.passwordHash || author.role !== 'admin') {
      await this.accessLog.log({ action: 'admin_login_fail', email: body.email, ip, userAgent, detail: !author ? 'not_found' : 'not_admin' })
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다')
    }

    const valid = await bcrypt.compare(body.password, author.passwordHash)
    if (!valid) {
      await this.accessLog.log({ action: 'admin_login_fail', email: body.email, ip, userAgent, detail: 'wrong_password' })
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다')
    }

    const token = this.jwtService.sign({ sub: author.id, slug: author.slug, role: author.role })

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    })

    await this.accessLog.log({ action: 'admin_login_success', authorId: author.id, email: body.email, ip, userAgent })

    return {
      user: {
        id: author.id, slug: author.slug, name: author.name,
        email: author.email, role: author.role,
      },
    }
  }

  // ─── 이하 모든 엔드포인트는 JWT + AdminGuard 필요 ───

  @Get('stats')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getStats() {
    return this.adminUseCase.getStats()
  }

  @Get('authors')
  @UseGuards(JwtAuthGuard, AdminGuard)
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
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getAuthor(@Param('authorId') authorId: string) {
    return this.adminUseCase.getAuthor(authorId)
  }

  @Post('authors')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async createAuthor(
    @Req() req: AuthenticatedRequest,
    @Body() body: { email: string; name: string; slug: string; password: string; plan?: string },
  ) {
    return this.adminUseCase.createAuthor(req.user.sub, body)
  }

  @Patch('authors/:authorId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async updateAuthor(
    @Req() req: AuthenticatedRequest,
    @Param('authorId') authorId: string,
    @Body() body: { name?: string; bio?: string },
  ) {
    return this.adminUseCase.updateAuthor(req.user.sub, authorId, body)
  }

  @Delete('authors/:authorId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async deleteAuthor(
    @Req() req: AuthenticatedRequest,
    @Param('authorId') authorId: string,
  ) {
    await this.adminUseCase.deleteAuthor(req.user.sub, authorId)
    return { deleted: true }
  }

  @Patch('authors/:authorId/role')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async changeRole(
    @Req() req: AuthenticatedRequest,
    @Param('authorId') authorId: string,
    @Body() body: { role: string },
  ) {
    return this.adminUseCase.changeRole(req.user.sub, authorId, body.role)
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('credits/grant')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async grantCredits(
    @Req() req: AuthenticatedRequest,
    @Body() body: { authorId: string; amount: number; reason: string },
  ) {
    return this.adminUseCase.grantCredits(req.user.sub, body.authorId, body.amount, body.reason)
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('credits/deduct')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async deductCredits(
    @Req() req: AuthenticatedRequest,
    @Body() body: { authorId: string; amount: number; reason: string },
  ) {
    return this.adminUseCase.deductCredits(req.user.sub, body.authorId, body.amount, body.reason)
  }

  @Get('credits/logs')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getCreditLogs(@Query('authorId') authorId?: string) {
    return this.adminUseCase.getAllCreditLogs(authorId)
  }

  @Patch('authors/:authorId/plan')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async changePlan(
    @Req() req: AuthenticatedRequest,
    @Param('authorId') authorId: string,
    @Body() body: { plan: string; durationDays: number },
  ) {
    await this.adminUseCase.changePlan(req.user.sub, authorId, body.plan, body.durationDays)
    return { success: true }
  }

  // ─── 콘텐츠 관리 ───

  @Get('works')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async listWorks(
    @Query('page') page?: string, @Query('limit') limit?: string,
    @Query('q') q?: string, @Query('authorId') authorId?: string,
  ) {
    return this.adminUseCase.listWorks({ page: page ? parseInt(page) : 1, limit: limit ? parseInt(limit) : 20, query: q, authorId })
  }

  @Get('works/:workId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getWorkDetail(@Param('workId') workId: string) {
    return this.adminUseCase.getWorkDetail(workId)
  }

  @Get('works/:workId/episodes/:episodeId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getEpisodeDetail(@Param('episodeId') episodeId: string) {
    return this.adminUseCase.getEpisodeDetail(episodeId)
  }

  @Patch('works/:workId/episodes/:episodeId/status')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async changeEpisodeStatus(
    @Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string,
    @Body() body: { status: string },
  ) {
    return this.adminUseCase.changeEpisodeStatus(req.user.sub, episodeId, body.status as any)
  }

  // ─── 댓글 관리 ───

  @Get('comments')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async listComments(
    @Query('page') page?: string, @Query('limit') limit?: string,
    @Query('episodeId') episodeId?: string, @Query('q') q?: string,
  ) {
    return this.adminUseCase.listComments({ page: page ? parseInt(page) : 1, limit: limit ? parseInt(limit) : 20, episodeId, query: q })
  }

  @Delete('comments/:commentId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async deleteComment(@Req() req: AuthenticatedRequest, @Param('commentId') commentId: string) {
    return this.adminUseCase.deleteComment(req.user.sub, commentId)
  }

  // ─── 결제 내역 ───

  @Get('payments')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async listPayments(
    @Query('page') page?: string, @Query('limit') limit?: string,
    @Query('authorId') authorId?: string, @Query('status') status?: string,
  ) {
    return this.adminUseCase.listPayments({ page: page ? parseInt(page) : 1, limit: limit ? parseInt(limit) : 20, authorId, status })
  }

  // ─── 접근 로그 ───

  @Get('access-logs')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async listAccessLogs(
    @Query('page') page?: string, @Query('limit') limit?: string,
    @Query('action') action?: string, @Query('ip') ip?: string, @Query('authorId') authorId?: string,
  ) {
    return this.adminUseCase.listAccessLogs({ page: page ? parseInt(page) : 1, limit: limit ? parseInt(limit) : 50, action, ip, authorId })
  }

  // ─── 사용자 제재 ───

  @Post('sanctions')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async sanctionUser(@Req() req: AuthenticatedRequest, @Body() body: { authorId: string; type: string; reason: string; detail?: string }) {
    return this.adminUseCase.sanctionUser(req.user.sub, body.authorId, body.type, body.reason, body.detail)
  }

  @Delete('sanctions/:sanctionId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async liftSanction(@Req() req: AuthenticatedRequest, @Param('sanctionId') sanctionId: string) {
    return this.adminUseCase.liftSanction(req.user.sub, sanctionId)
  }

  @Get('sanctions')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async listSanctions(@Query('authorId') authorId?: string) {
    return this.adminUseCase.listSanctions(authorId)
  }

  // ─── 콘텐츠 신고 ───

  @Get('reports')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async listReports(@Query('page') page?: string, @Query('limit') limit?: string, @Query('status') status?: string) {
    return this.adminUseCase.listReports({ page: page ? parseInt(page) : 1, limit: limit ? parseInt(limit) : 20, status })
  }

  @Patch('reports/:reportId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async resolveReport(@Req() req: AuthenticatedRequest, @Param('reportId') reportId: string, @Body() body: { action: 'approved' | 'rejected' }) {
    return this.adminUseCase.resolveReport(req.user.sub, reportId, body.action)
  }

  // ─── 시스템 설정 ───

  @Get('settings')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getSettings() {
    return this.adminUseCase.getSettings()
  }

  @Patch('settings/:key')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async updateSetting(@Req() req: AuthenticatedRequest, @Param('key') key: string, @Body() body: { value: string }) {
    return this.adminUseCase.updateSetting(req.user.sub, key, body.value)
  }

  // ─── 시계열 통계 ───

  @Get('stats/timeseries')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getTimeseries(@Query('metric') metric: string, @Query('days') days?: string) {
    return this.adminUseCase.getTimeseries(metric, days ? parseInt(days) : 30)
  }

  // ─── 공지사항 ───

  @Get('announcements')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async listAnnouncements(@Query('page') page?: string) {
    return this.adminUseCase.listAnnouncements(page ? parseInt(page) : 1)
  }

  @Post('announcements')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async createAnnouncement(@Req() req: AuthenticatedRequest, @Body() body: { title: string; content: string; isPinned?: boolean; target?: string }) {
    return this.adminUseCase.createAnnouncement(req.user.sub, body)
  }

  @Delete('announcements/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async deleteAnnouncement(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.adminUseCase.deleteAnnouncement(req.user.sub, id)
  }

  // ─── 추천 작품 ───

  @Get('featured')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async listFeatured(@Query('section') section?: string) {
    return this.adminUseCase.listFeatured(section)
  }

  @Post('featured')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async addFeatured(@Req() req: AuthenticatedRequest, @Body() body: { workId: string; section?: string; position?: number }) {
    return this.adminUseCase.addFeatured(req.user.sub, body)
  }

  @Delete('featured/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async removeFeatured(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.adminUseCase.removeFeatured(req.user.sub, id)
  }

  // ─── 수익 대시보드 ───

  @Get('revenue')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getRevenue() { return this.adminUseCase.getRevenueSummary() }

  // ─── 테마 프리셋 관리 ───

  @Get('themes')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async listSystemThemes() { return this.adminUseCase.listSystemThemes() }

  @Post('themes')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async createSystemTheme(@Req() req: AuthenticatedRequest, @Body() body: { name: string; preset: string; overrides: any }) {
    return this.adminUseCase.createSystemTheme(req.user.sub, body)
  }

  @Patch('themes/:themeId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async updateSystemTheme(@Req() req: AuthenticatedRequest, @Param('themeId') themeId: string, @Body() body: { name?: string; overrides?: any }) {
    return this.adminUseCase.updateSystemTheme(req.user.sub, themeId, body)
  }

  @Delete('themes/:themeId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async deleteSystemTheme(@Req() req: AuthenticatedRequest, @Param('themeId') themeId: string) {
    return this.adminUseCase.deleteSystemTheme(req.user.sub, themeId)
  }

  // ─── 감사 로그 ───

  @Get('audit-logs')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getAuditLogs(@Query('page') page?: string, @Query('limit') limit?: string, @Query('action') action?: string) {
    return this.adminUseCase.getAuditLogs({ page: page ? parseInt(page) : 1, limit: limit ? parseInt(limit) : 50, action })
  }
}
