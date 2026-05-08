import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Post, Body, Get, Req, Res, UseGuards, ForbiddenException } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Request, Response } from 'express'
import { AuthUseCase } from '@application/auth/auth.usecase'
import { RegisterDto, LoginDto } from '@adapter/inbound/http/dto/auth.dto'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { verifyRecaptcha } from '@adapter/inbound/http/util/recaptcha-verifier'
import { AccessLogService } from '@infrastructure/security/access-log.service'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { isRemoteEnv } from '@infrastructure/config/app-env'

/** 쿠키 상수 */
const ACCESS_COOKIE = 'grimoire_token'
const REFRESH_COOKIE = 'grimoire_refresh'
const ACCESS_MAX_AGE = 15 * 60 * 1000         // 15분
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000  // 7일

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    // HTTPS를 쓰는 모든 원격 환경(dev/prod)에서 secure=true.
    // 과거 NODE_ENV==='production' 체크는 암묵적 의존성이라 APP_ENV 기반으로 전환.
    secure: isRemoteEnv(),
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  }
}

function setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_MAX_AGE))
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_MAX_AGE))
}

function clearTokenCookies(res: Response) {
  res.cookie(ACCESS_COOKIE, '', cookieOptions(0))
  res.cookie(REFRESH_COOKIE, '', cookieOptions(0))
}

function extractClientInfo(req: Request) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || undefined
  const userAgent = req.headers['user-agent'] || undefined
  return { ip, userAgent }
}

function userResponse(author: { id: string; slug: string; name: string; email: string; credits: number; role: string; bio?: string | null }) {
  return { id: author.id, slug: author.slug, name: author.name, email: author.email, credits: author.credits, role: author.role, bio: author.bio ?? undefined }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authUseCase: AuthUseCase,
    private readonly accessLog: AccessLogService,
    private readonly prisma: PrismaService,
  ) {}

  @Throttle({ default: { ttl: 3600000, limit: 5 } })  // 시간당 5회
  @Post('register')
  async register(
    @Body() dto: RegisterDto & { recaptchaToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await verifyRecaptcha(dto.recaptchaToken || '')
    const { author, accessToken, refreshToken } = await this.authUseCase.register(dto)
    setTokenCookies(res, accessToken, refreshToken)

    const { ip, userAgent } = extractClientInfo(req)
    await this.accessLog.log({ action: 'register', authorId: author.id, email: dto.email, ip, userAgent })

    return { user: userResponse(author) }
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Post('login')
  async login(
    @Body() dto: LoginDto & { recaptchaToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await verifyRecaptcha(dto.recaptchaToken || '')
    const { ip, userAgent } = extractClientInfo(req)

    // EMAIL-P0-3: identifier 통합 박제 — slug 로그인 시 slug, email 로그인 시 email
    // AccessLog.email 컬럼은 schema 변경 0건 정책으로 양립 사용 (identifier 통합), detail에 type 박제
    const identifier = dto.email ?? dto.slug ?? ''
    const identifierType: 'email' | 'slug' = dto.email ? 'email' : 'slug'

    try {
      const { author, accessToken, refreshToken } = await this.authUseCase.login(dto)

      // 제재 확인 — 만료된 제재 자동 해제 후 활성 제재 확인
      await this.prisma.userSanction.updateMany({
        where: { authorId: author.id, isActive: true, endAt: { not: null, lt: new Date() } },
        data: { isActive: false },
      })
      const sanction = await this.prisma.userSanction.findFirst({
        where: { authorId: author.id, isActive: true },
      })
      if (sanction) {
        await this.accessLog.log({ action: 'login_blocked', authorId: author.id, email: identifier, ip, userAgent, detail: `sanction:${sanction.type};identifierType:${identifierType}` })
        throw new ForbiddenException(`계정이 정지되었습니다. 사유: ${sanction.reason}${sanction.endAt ? ` (해제: ${sanction.endAt.toISOString().split('T')[0]})` : ' (영구)'}`)
      }

      setTokenCookies(res, accessToken, refreshToken)
      await this.accessLog.log({ action: 'login_success', authorId: author.id, email: identifier, ip, userAgent, detail: `identifierType:${identifierType}` })

      return { user: userResponse(author) }
    } catch (err) {
      await this.accessLog.log({ action: 'login_fail', email: identifier, ip, userAgent, detail: `${(err as Error).message};identifierType:${identifierType}` })
      throw err
    }
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Post('google')
  async googleLogin(
    @Body() body: { token: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { ip, userAgent } = extractClientInfo(req)
    const { author, accessToken, refreshToken } = await this.authUseCase.googleLogin(body.token)
    setTokenCookies(res, accessToken, refreshToken)

    await this.accessLog.log({ action: 'login_success', authorId: author.id, email: author.email, ip, userAgent, detail: 'google_oauth' })

    return { user: userResponse(author) }
  }

  @Throttle({ default: { ttl: 60000, limit: 30 } })  // 분당 30회 (자동 갱신 고려)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshTokenValue = req.cookies?.[REFRESH_COOKIE]
    if (!refreshTokenValue) {
      throw new ForbiddenException('리프레시 토큰이 없습니다')
    }

    const { author, accessToken, refreshToken } = await this.authUseCase.refreshAccessToken(refreshTokenValue)
    setTokenCookies(res, accessToken, refreshToken)

    return { user: userResponse(author) }
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshTokenValue = req.cookies?.[REFRESH_COOKIE]
    await this.authUseCase.revokeRefreshToken(refreshTokenValue)
    clearTokenCookies(res)
    return { loggedOut: true }
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async profile(@Req() req: AuthenticatedRequest) {
    const author = await this.authUseCase.getProfile(req.user.sub)
    return userResponse(author)
  }

  @Throttle({ default: { ttl: 3600000, limit: 5 } })  // 시간당 5회
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @Req() req: AuthenticatedRequest & Request,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    await this.authUseCase.changePassword(req.user.sub, body.currentPassword, body.newPassword)

    const { ip, userAgent } = extractClientInfo(req as Request)
    await this.accessLog.log({ action: 'password_change', authorId: req.user.sub, ip, userAgent })

    return { success: true }
  }
}
