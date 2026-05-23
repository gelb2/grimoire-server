import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, Res, UseGuards, UnauthorizedException, BadRequestException } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Request, Response } from 'express'
import * as bcrypt from 'bcryptjs'
import { JwtService } from '@nestjs/jwt'
import { AdminUseCase } from '@application/admin/admin.usecase'
import { UserSoftDeleteUseCase } from '@application/author/user-soft-delete.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { AdminGuard } from '@adapter/inbound/http/guard/admin.guard'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { AccessLogService } from '@infrastructure/security/access-log.service'
import { isRemoteEnv } from '@infrastructure/config/app-env'
import {
  CIRCUIT_BREAKER_KEYS,
  CircuitBreakerActionDto,
  CircuitBreakerActionResponseDto,
  CircuitBreakerKey,
  CircuitBreakerStateResponseDto,
  toCircuitBreakerStateResponse,
} from '@adapter/inbound/http/dto/circuit-breaker.dto'

interface AuthenticatedRequest {
  user: { sub: string; slug: string; role: string }
}

const ACCESS_COOKIE = 'grimoire_token'
const ACCESS_MAX_AGE = 15 * 60 * 1000  // 15분

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminUseCase: AdminUseCase,
    private readonly userSoftDelete: UserSoftDeleteUseCase,
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

    res.cookie(ACCESS_COOKIE, token, {
      httpOnly: true,
      secure: isRemoteEnv(),
      sameSite: 'strict',
      maxAge: ACCESS_MAX_AGE,
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

  /**
   * USER-SOFT-DELETE sprint (2026-05-15) — 운영자 강제 Author 영역 영역 영역 영역 엔드포인트.
   * Soft delete + GDPR 익명화 + RefreshToken 즉시 무효 + AdminAuditLog admin_force_delete 박제 영역.
   * 사유 영역 필수.
   *
   * 정본: .claude/state/sprint-user-soft-delete-draft.md §5-4 Hexagonal 흐름 매트릭스
   * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
   */
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('authors/:authorId/force-delete')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async forceDeleteAuthor(
    @Req() req: AuthenticatedRequest,
    @Param('authorId') authorId: string,
    @Body() body: { reason: string },
  ) {
    await this.userSoftDelete.execute(authorId, 'admin', req.user.sub, body.reason)
    return { deleted: true, message: '운영자 강제 삭제 완료. 30일 후 자동 영구 삭제 정합.' }
  }

  /**
   * USER-SOFT-DELETE sprint (2026-05-15) — 운영자 GDPR 익명화 only 엔드포인트 영역 (qa #20 server-web 정합 보강).
   *
   * GDPR Article 17 (Right to Erasure) 영역 정합 — email + name + passwordHash + bio 4 필드 익명화만.
   * soft delete X (계정 유지) + RefreshToken revoke X (탈퇴 영역 영역 영역).
   *
   * 사유(reason) 필수 — AdminAuditLog gdpr_anonymize 영역 박제.
   *
   * 정본: .claude/state/sprint-user-soft-delete-draft.md §15-1 anonymize-only 분기
   * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
   */
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('authors/:authorId/anonymize')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async anonymizeAuthor(
    @Req() req: AuthenticatedRequest,
    @Param('authorId') authorId: string,
    @Body() body: { reason: string },
  ) {
    if (!body || !body.reason || body.reason.trim().length === 0) {
      throw new BadRequestException('GDPR 익명화 시 사유(reason) 필수')
    }
    return this.userSoftDelete.anonymizeOnly(authorId, req.user.sub, body.reason)
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
    // 크레딧 개편 CC-1 (2026-05-19) — source(출처) 운영자 명시. 미지정 시 'charged' 폴백.
    @Body() body: { authorId: string; amount: number; reason: string; source?: string },
  ) {
    return this.adminUseCase.grantCredits(req.user.sub, body.authorId, body.amount, body.reason, body.source)
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

  // ─── Circuit Breaker 운영자 admin (PAY-S3 Phase A — 2026-05-23) ───
  //
  // ADR-009 §"잔존 영역" 4번째 항목 해소 — port (forceOpen/forceClose) 위 HTTP admin 박제.
  // 정본: shared-contracts §27 CircuitBreakerPolicy.
  //
  // graceful 설계 (plan-draft §4):
  // - GET /admin/circuit-breaker/state — 항시 가용, 호출 비용 0. @Throttle 분당 60회 (운영 폴링 허용).
  // - POST /admin/circuit-breaker/trip — 파괴적 액션 ⚠️ 결제 즉시 503. reason 빈값 400. key 화이트리스트 400.
  //   @Throttle 분당 5회 (운영자 호출 빈도 상한).
  // - POST /admin/circuit-breaker/reset — 수동 복구. reason/key 검증 동일. @Throttle 분당 5회.

  /**
   * env 정수 파싱 (NaN/음수 fallback) — adapter `parseEnvInt` 와 동일 정책.
   * controller 가 응답 policy 4값 동봉 시 사용.
   */
  private parsePolicyEnvInt(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback
    const parsed = parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  /**
   * 응답 동봉용 policy 4값 — adapter 와 동일 fallback (5/30000/3/60000).
   */
  private getCircuitBreakerPolicy(): {
    failureThreshold: number
    cooldownMs: number
    halfOpenTrial: number
    resetWindowMs: number
  } {
    return {
      failureThreshold: this.parsePolicyEnvInt(process.env.POLAR_CB_FAILURE_THRESHOLD, 5),
      cooldownMs: this.parsePolicyEnvInt(process.env.POLAR_CB_COOLDOWN_MS, 30_000),
      halfOpenTrial: this.parsePolicyEnvInt(process.env.POLAR_CB_HALF_OPEN_TRIAL, 3),
      resetWindowMs: this.parsePolicyEnvInt(process.env.POLAR_CB_RESET_WINDOW_MS, 60_000),
    }
  }

  /**
   * key 화이트리스트 검증 — CIRCUIT_BREAKER_KEYS 외 입력 시 400 (운영자 오타 방어).
   *
   * 본 검증은 DTO `@IsIn` 외에 controller 영역에서도 명시적 강제 — query param(`GET`) 도 검증 정합.
   */
  private assertCircuitBreakerKey(key: string): CircuitBreakerKey {
    if (!CIRCUIT_BREAKER_KEYS.includes(key as CircuitBreakerKey)) {
      throw new BadRequestException(
        `지원하지 않는 Circuit Breaker key — 허용: ${CIRCUIT_BREAKER_KEYS.join(', ')}`,
      )
    }
    return key as CircuitBreakerKey
  }

  /**
   * reason 빈값/공백만 검증 — 400 BadRequest (사후 추적 강제).
   */
  private assertReason(reason: string | undefined): string {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Circuit Breaker 수동 차단/복구 시 사유(reason) 필수')
    }
    return reason
  }

  /**
   * GET /admin/circuit-breaker/state — 호출점 상태 조회 (운영 모니터링).
   *
   * query `key` 지정 시 단일 상태 — 화이트리스트 외 입력 시 400.
   * 미지정 시 화이트리스트 2 호출점 모두 반환 (운영자 일괄 모니터링).
   *
   * 응답: `{ states: CircuitBreakerStateResponseDto[] }` — 내부 ID 노출 0건.
   */
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Get('circuit-breaker/state')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getCircuitBreakerState(
    @Query('key') key?: string,
  ): Promise<{ states: CircuitBreakerStateResponseDto[] }> {
    const policy = this.getCircuitBreakerPolicy()
    const targetKeys: CircuitBreakerKey[] = key
      ? [this.assertCircuitBreakerKey(key)]
      : [...CIRCUIT_BREAKER_KEYS]

    const states = await Promise.all(
      targetKeys.map(async (k) => {
        const stats = await this.adminUseCase.getCircuitBreakerState(k)
        return toCircuitBreakerStateResponse(k, stats, policy)
      }),
    )
    return { states }
  }

  /**
   * POST /admin/circuit-breaker/trip — Circuit Breaker 수동 차단.
   *
   * ⚠️ 파괴적 액션 — 호출 즉시 해당 호출점 `polar:checkouts:*` 결제 503 변환.
   * 사고 대응 / 연습 / 점검 전용. 운영자 행위 AuditLog `circuit_breaker.manual_trip` 박제.
   *
   * Body: `CircuitBreakerActionDto` (key 화이트리스트 + reason 필수)
   * 응답: `{ success: true, beforeState, afterState }` (§20 정합)
   */
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('circuit-breaker/trip')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async tripCircuitBreaker(
    @Req() req: AuthenticatedRequest,
    @Body() body: CircuitBreakerActionDto,
  ): Promise<CircuitBreakerActionResponseDto> {
    const key = this.assertCircuitBreakerKey(body?.key)
    const reason = this.assertReason(body?.reason)
    const { beforeState, afterState } = await this.adminUseCase.tripCircuitBreaker(
      req.user.sub,
      key,
      reason,
    )
    return {
      success: true,
      beforeState: beforeState.state,
      afterState: afterState.state,
    }
  }

  /**
   * POST /admin/circuit-breaker/reset — Circuit Breaker 수동 복구.
   *
   * `forceClose` 호출 — failureCount=0 / state=CLOSED 강제. 운영자 사고 후 복원 용도.
   * 운영자 행위 AuditLog `circuit_breaker.manual_reset` 박제.
   *
   * Body: `CircuitBreakerActionDto` (key 화이트리스트 + reason 필수)
   * 응답: `{ success: true, beforeState, afterState }`
   */
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('circuit-breaker/reset')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async resetCircuitBreaker(
    @Req() req: AuthenticatedRequest,
    @Body() body: CircuitBreakerActionDto,
  ): Promise<CircuitBreakerActionResponseDto> {
    const key = this.assertCircuitBreakerKey(body?.key)
    const reason = this.assertReason(body?.reason)
    const { beforeState, afterState } = await this.adminUseCase.resetCircuitBreaker(
      req.user.sub,
      key,
      reason,
    )
    return {
      success: true,
      beforeState: beforeState.state,
      afterState: afterState.state,
    }
  }
}
