import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Post, Body, Get, Req, Res, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Request, Response } from 'express'
import { AuthUseCase } from '@application/auth/auth.usecase'
import { RegisterDto, LoginDto } from '@adapter/inbound/http/dto/auth.dto'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { verifyRecaptcha } from '@adapter/inbound/http/util/recaptcha-verifier'
import { AccessLogService } from '@infrastructure/security/access-log.service'

/** 쿠키 옵션 상수 */
const COOKIE_NAME = 'grimoire_token'
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000 // 7일 (ms)

function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
}

function clearAuthCookie(res: Response): void {
  res.cookie(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
}

function extractClientInfo(req: Request) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || undefined
  const userAgent = req.headers['user-agent'] || undefined
  return { ip, userAgent }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authUseCase: AuthUseCase,
    private readonly accessLog: AccessLogService,
  ) {}

  @Throttle({ default: { ttl: 3600000, limit: 5 } })  // 시간당 5회
  @Post('register')
  async register(
    @Body() dto: RegisterDto & { recaptchaToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await verifyRecaptcha(dto.recaptchaToken || '')
    const { author, token } = await this.authUseCase.register(dto)
    setAuthCookie(res, token)

    const { ip, userAgent } = extractClientInfo(req)
    await this.accessLog.log({ action: 'register', authorId: author.id, email: dto.email, ip, userAgent })

    return {
      user: {
        id: author.id, slug: author.slug, name: author.name,
        email: author.email, credits: author.credits, role: author.role,
      },
    }
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

    try {
      const { author, token } = await this.authUseCase.login(dto)
      setAuthCookie(res, token)

      await this.accessLog.log({ action: 'login_success', authorId: author.id, email: dto.email, ip, userAgent })

      return {
        user: {
          id: author.id, slug: author.slug, name: author.name,
          email: author.email, credits: author.credits, role: author.role,
        },
      }
    } catch (err) {
      await this.accessLog.log({ action: 'login_fail', email: dto.email, ip, userAgent, detail: (err as Error).message })
      throw err
    }
  }

  @Post('google')
  async googleLogin(
    @Body() body: { token: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { ip, userAgent } = extractClientInfo(req)
    const { author, token } = await this.authUseCase.googleLogin(body.token)
    setAuthCookie(res, token)

    await this.accessLog.log({ action: 'login_success', authorId: author.id, email: author.email, ip, userAgent, detail: 'google_oauth' })

    return {
      user: {
        id: author.id, slug: author.slug, name: author.name,
        email: author.email, credits: author.credits, role: author.role,
      },
    }
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    clearAuthCookie(res)
    return { loggedOut: true }
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async profile(@Req() req: AuthenticatedRequest) {
    const author = await this.authUseCase.getProfile(req.user.sub)
    return {
      id: author.id, slug: author.slug, name: author.name,
      email: author.email, credits: author.credits, role: author.role,
    }
  }

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
