import { Request } from 'express'

/** JWT 인증 후 request.user에 들어가는 페이로드 */
export interface JwtPayload {
  sub: string       // authorId
  slug: string       // author slug
  email: string
  role?: string
}

/** JwtAuthGuard 통과 후의 Request 타입 */
export interface AuthenticatedRequest extends Request {
  user: JwtPayload
}
