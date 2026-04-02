import { Request } from 'express'

/**
 * 클라이언트 IP를 추출한다.
 * Azure App Service / 리버스 프록시 환경에서 X-Forwarded-For를 우선 사용.
 */
export function extractClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim()
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(',')[0].trim()
  }

  const realIp = req.headers['x-real-ip']
  if (typeof realIp === 'string') {
    return realIp.trim()
  }

  return req.ip || '0.0.0.0'
}
