import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Post, Body, Get, Req, Res, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Response } from 'express'
import { AuthUseCase } from '@application/auth/auth.usecase'
import { RegisterDto, LoginDto } from '@adapter/inbound/http/dto/auth.dto'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

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

@Controller('auth')
export class AuthController {
  constructor(private readonly authUseCase: AuthUseCase) {}

  @Throttle({ default: { ttl: 3600000, limit: 5 } })  // 시간당 5회
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { author, token } = await this.authUseCase.register(dto)
    setAuthCookie(res, token)
    return {
      user: {
        id: author.id,
        slug: author.slug,
        name: author.name,
        email: author.email,
        credits: author.credits,
      },
    }
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { author, token } = await this.authUseCase.login(dto)
    setAuthCookie(res, token)
    return {
      user: {
        id: author.id,
        slug: author.slug,
        name: author.name,
        email: author.email,
        credits: author.credits,
      },
    }
  }

  @Post('google')
  async googleLogin(@Body() body: { token: string }, @Res({ passthrough: true }) res: Response) {
    const { author, token } = await this.authUseCase.googleLogin(body.token)
    setAuthCookie(res, token)
    return {
      user: {
        id: author.id,
        slug: author.slug,
        name: author.name,
        email: author.email,
        credits: author.credits,
      },
    }
  }

  /** 로그아웃 — HttpOnly 쿠키 제거 */
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
      id: author.id,
      slug: author.slug,
      name: author.name,
      email: author.email,
      credits: author.credits,
    }
  }
}
