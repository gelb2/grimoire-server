import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()

    // 1순위: Authorization 헤더 (API 클라이언트)
    const authHeader = request.headers.authorization
    let token: string | undefined

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }

    // 2순위: HttpOnly 쿠키 (브라우저)
    if (!token && request.cookies?.grimoire_token) {
      token = request.cookies.grimoire_token
    }

    if (!token) {
      throw new UnauthorizedException('인증 토큰이 필요합니다')
    }

    try {
      const payload = this.jwtService.verify(token)
      request.user = payload
      return true
    } catch {
      throw new UnauthorizedException('유효하지 않은 토큰입니다')
    }
  }
}
