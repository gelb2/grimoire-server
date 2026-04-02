import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

/**
 * 토큰이 있으면 req.user를 세팅하고, 없으면 req.user = null로 통과시킨다.
 * 비로그인 사용자도 접근할 수 있는 엔드포인트에 사용.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()

    const authHeader = request.headers.authorization
    let token: string | undefined

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }

    if (!token && request.cookies?.grimoire_token) {
      token = request.cookies.grimoire_token
    }

    if (!token) {
      request.user = null
      return true
    }

    try {
      const payload = this.jwtService.verify(token)
      request.user = payload
    } catch {
      request.user = null
    }

    return true
  }
}
