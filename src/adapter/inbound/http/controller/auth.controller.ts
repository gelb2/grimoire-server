import { Controller, Post, Body, Get, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AuthUseCase } from '@application/auth/auth.usecase'
import { RegisterDto, LoginDto } from '@adapter/inbound/http/dto/auth.dto'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('auth')
export class AuthController {
  constructor(private readonly authUseCase: AuthUseCase) {}

  @Throttle({ default: { ttl: 3600000, limit: 5 } })  // 시간당 5회
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const { author, token } = await this.authUseCase.register(dto)
    return {
      user: {
        id: author.id,
        slug: author.slug,
        name: author.name,
        email: author.email,
        credits: author.credits,
      },
      token,
    }
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Post('login')
  async login(@Body() dto: LoginDto) {
    const { author, token } = await this.authUseCase.login(dto)
    return {
      user: {
        id: author.id,
        slug: author.slug,
        name: author.name,
        email: author.email,
        credits: author.credits,
      },
      token,
    }
  }

  @Post('google')
  async googleLogin(@Body() body: { token: string }) {
    const { author, token } = await this.authUseCase.googleLogin(body.token)
    return {
      user: {
        id: author.id,
        slug: author.slug,
        name: author.name,
        email: author.email,
        credits: author.credits,
      },
      token,
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async profile(@Req() req: any) {
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
