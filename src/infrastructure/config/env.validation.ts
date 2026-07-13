import { getAppEnv, isRemoteEnv, isProduction } from './app-env'

/** 부트스트랩 시 환경 변수 검증 */
export function validateEnv(): void {
  // 필수 — 없으면 서버 부팅 차단
  // ANTHROPIC_API_KEY는 로컬 개발 시 없어도 서버 부팅 가능 (AI 기능만 비활성)
  // PUBLIC_API_BASE_URL은 응답 시 bakedCssUrl 절대화에 사용 (P1-#7, 2026-05-03)
  const required = ['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGIN', 'PUBLIC_API_BASE_URL']
  const missing = required.filter((key) => !process.env[key])
  if (missing.length > 0) {
    console.error(`필수 환경 변수 누락: ${missing.join(', ')}`)
    process.exit(1)
  }

  // PUBLIC_API_BASE_URL 형식 검증 — 절대 URL이어야 응답 절대화 정합 보장
  const publicApiBase = process.env.PUBLIC_API_BASE_URL ?? ''
  if (!/^https?:\/\//.test(publicApiBase)) {
    console.error(`PUBLIC_API_BASE_URL은 절대 URL이어야 합니다 (현재 값: "${publicApiBase}")`)
    process.exit(1)
  }

  const appEnv = getAppEnv()
  console.log(`[env] APP_ENV=${appEnv}, NODE_ENV=${process.env.NODE_ENV || '(unset)'}`)

  // 원격 환경(development/production)에서 필수 — 미설정 시 서버 부팅 차단
  const remoteRequired: { key: string; label: string }[] = []

  for (const { key, label } of remoteRequired) {
    if (!process.env[key]) {
      if (isRemoteEnv()) {
        console.error(`CRITICAL: ${label}이(가) ${appEnv} 환경에서 설정되지 않았습니다. 서버를 시작할 수 없습니다.`)
        process.exit(1)
      }
      console.warn(`${label} 미설정 — 로컬 기본값 사용 (원격 환경에서는 반드시 설정할 것)`)
    }
  }

  // F-12 (2026-07-11) — production 필수: Polar 결제(MoR) 시크릿.
  // 미설정 시 결제 silent 파손(webhook 은 isProduction()→reject, reconciliation 일부만 보완)
  // → prod 부팅 차단. dev/localhost 는 관대(Polar 없이 로컬 개발 가능 — 부팅 회귀 방지).
  const productionRequired: { key: string; label: string }[] = [
    { key: 'POLAR_ACCESS_TOKEN', label: 'POLAR_ACCESS_TOKEN (Polar 결제 API)' },
    { key: 'POLAR_WEBHOOK_SECRET', label: 'POLAR_WEBHOOK_SECRET (Polar 웹훅 서명 검증)' },
  ]

  for (const { key, label } of productionRequired) {
    if (!process.env[key]) {
      if (isProduction()) {
        console.error(`CRITICAL: ${label}이(가) production 환경에서 설정되지 않았습니다. 서버를 시작할 수 없습니다.`)
        process.exit(1)
      }
      console.warn(`[env] ${label} 미설정 — dev/localhost 관대 모드 (production 에서는 필수)`)
    }
  }

  // 선택적 API 키 — 없으면 경고만, 서버는 부팅됨
  // (구 PAYAPP_* 그룹 제거 — PayappAdapter 폐기됨(payment-gateway.port.ts). 실사용은 Polar,
  //  Polar 시크릿은 위 productionRequired 로 승격. 'Payment disabled' 오해성 경고 제거.)
  const optionalGroups: { keys: string[]; warning: string }[] = [
    { keys: ['GOOGLE_CLIENT_ID'], warning: 'Google OAuth disabled' },
    { keys: ['ANTHROPIC_API_KEY'], warning: 'Theme AI generation disabled' },
    { keys: ['OPENAI_API_KEY'], warning: 'RAG analysis disabled' },
  ]

  for (const group of optionalGroups) {
    const missingKeys = group.keys.filter((key) => !process.env[key])
    if (missingKeys.length > 0) {
      console.warn(`[env] ${missingKeys.join(', ')} 미설정 — ${group.warning}`)
    }
  }
}
