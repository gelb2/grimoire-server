/**
 * APP_ENV — 애플리케이션 환경 구분자
 *
 * NODE_ENV 대신 이 변수를 써서 4개 환경(localhost/development/inhouse/production)을
 * 구분한다. NODE_ENV는 라이브러리 표준 (production/development/test) 전용으로 둔다.
 *
 * 참조: docs/environments.md, docs/DEPLOY.md
 *
 * 값:
 *   - localhost    : 로컬 개발 (Docker Compose DB, localhost:3000)
 *   - development  : dev 환경 (dev.grimoire-book.com)
 *   - inhouse      : 내부 QA 환경 (inhouse.grimoire-book.com)
 *   - production   : 실서비스 (grimoire-book.com)
 */

export type AppEnv = 'localhost' | 'development' | 'inhouse' | 'production'

const VALID_VALUES: readonly AppEnv[] = ['localhost', 'development', 'inhouse', 'production'] as const

/**
 * 현재 APP_ENV 값을 반환한다.
 *
 * - APP_ENV 환경변수가 설정돼 있으면 그 값을 쓴다.
 * - 설정돼 있지 않으면 NODE_ENV로 폴백:
 *   - production → 'production'
 *   - development → 'development'
 *   - 그 외      → 'localhost'
 * - 미지의 값이면 'localhost'로 폴백 + 경고 (부트스트랩 외 런타임에 조용히 안전한 기본값)
 */
export function getAppEnv(): AppEnv {
  const raw = process.env.APP_ENV
  if (raw && (VALID_VALUES as readonly string[]).includes(raw)) {
    return raw as AppEnv
  }

  // 폴백: NODE_ENV 기반 추정
  const nodeEnv = process.env.NODE_ENV
  if (nodeEnv === 'production') return 'production'
  if (nodeEnv === 'development') return 'development'
  return 'localhost'
}

/** HTTPS를 사용하는 원격 환경 여부 (쿠키 secure 플래그, CORS 등 판단용) */
export function isRemoteEnv(): boolean {
  return getAppEnv() !== 'localhost'
}

/** 실서비스(production) 여부 */
export function isProduction(): boolean {
  return getAppEnv() === 'production'
}
