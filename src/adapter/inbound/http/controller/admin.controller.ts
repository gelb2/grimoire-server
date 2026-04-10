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

  @Get('audit-logs')
  @UseGuards(JwtAuthGuard, AdminGuard)
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
