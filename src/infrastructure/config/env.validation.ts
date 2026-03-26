/** 부트스트랩 시 필수 환경 변수 검증 */
export function validateEnv(): void {
  const required = ['DATABASE_URL', 'ANTHROPIC_API_KEY']
  const missing = required.filter((key) => !process.env[key])
  if (missing.length > 0) {
    console.error(`필수 환경 변수 누락: ${missing.join(', ')}`)
    process.exit(1)
  }

  // JWT_SECRET: 선택 (미설정 시 개발용 기본값 사용)
  if (!process.env.JWT_SECRET) {
    console.warn('JWT_SECRET 미설정 — 개발용 기본값 사용 (프로덕션에서는 반드시 설정할 것)')
  }
}
