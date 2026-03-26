/** 부트스트랩 시 필수 환경 변수 검증 */
export function validateEnv(): void {
  const required = ['DATABASE_URL', 'ANTHROPIC_API_KEY']
  const missing = required.filter((key) => !process.env[key])
  if (missing.length > 0) {
    console.error(`필수 환경 변수 누락: ${missing.join(', ')}`)
    process.exit(1)
  }
}
