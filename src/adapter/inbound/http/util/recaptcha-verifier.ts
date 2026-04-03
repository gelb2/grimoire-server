import { BadRequestException } from '@nestjs/common'

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify'
const MIN_SCORE = 0.5

/**
 * reCAPTCHA v3 토큰을 Google 서버에서 검증한다.
 * 점수가 기준 미달이거나 검증 실패 시 BadRequestException을 던진다.
 */
export async function verifyRecaptcha(token: string): Promise<void> {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY
  if (!secretKey) {
    // 시크릿 키 미설정 시 검증 스킵 (로컬 개발 환경)
    return
  }

  if (!token) {
    throw new BadRequestException('reCAPTCHA 토큰이 필요합니다')
  }

  try {
    const response = await fetch(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secretKey}&response=${token}`,
    })

    const data = await response.json()

    if (!data.success) {
      throw new BadRequestException('reCAPTCHA 검증에 실패했습니다')
    }

    if (data.score < MIN_SCORE) {
      throw new BadRequestException('자동화된 요청이 감지되었습니다')
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error
    // 네트워크 오류 등은 통과시킨다 (reCAPTCHA 장애 시 서비스 중단 방지)
    console.warn('reCAPTCHA 검증 중 오류 발생, 통과 처리:', error)
  }
}
