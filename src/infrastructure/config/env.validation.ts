/** 부트스트랩 시 환경 변수 검증 */
export function validateEnv(): void {
  // 필수 — 없으면 서버 부팅 차단
  // ANTHROPIC_API_KEY는 로컬 개발 시 없어도 서버 부팅 가능 (AI 기능만 비활성)
  const required = ['DATABASE_URL']
  const missing = required.filter((key) => !process.env[key])
  if (missing.length > 0) {
    console.error(`필수 환경 변수 누락: ${missing.join(', ')}`)
    process.exit(1)
  }

  // 원격 환경(development/inhouse/production)에서 필수 — 미설정 시 서버 부팅 차단
  const isRemote = process.env.NODE_ENV && process.env.NODE_ENV !== 'localhost'
  const remoteRequired: { key: string; label: string }[] = [
    { key: 'JWT_SECRET', label: 'JWT_SECRET' },
    { key: 'CORS_ORIGIN', label: 'CORS_ORIGIN' },
  ]

  for (const { key, label } of remoteRequired) {
    if (!process.env[key]) {
      if (isRemote) {
        console.error(`CRITICAL: ${label}이(가) ${process.env.NODE_ENV} 환경에서 설정되지 않았습니다. 서버를 시작할 수 없습니다.`)
        process.exit(1)
      }
      console.warn(`${label} 미설정 — 로컬 기본값 사용 (원격 환경에서는 반드시 설정할 것)`)
    }
  }

  // 선택적 API 키 — 없으면 경고만, 서버는 부팅됨
  const optionalGroups: { keys: string[]; warning: string }[] = [
    { keys: ['GOOGLE_CLIENT_ID'], warning: 'Google OAuth disabled' },
    { keys: ['ANTHROPIC_API_KEY'], warning: 'Theme AI generation disabled' },
    { keys: ['OPENAI_API_KEY'], warning: 'RAG analysis disabled' },
    { keys: ['PAYAPP_USER_ID', 'PAYAPP_API_KEY', 'PAYAPP_SECRET'], warning: 'Payment disabled' },
  ]

  for (const group of optionalGroups) {
    const missingKeys = group.keys.filter((key) => !process.env[key])
    if (missingKeys.length > 0) {
      console.warn(`[env] ${missingKeys.join(', ')} 미설정 — ${group.warning}`)
    }
  }
}
