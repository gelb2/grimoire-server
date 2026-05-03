/**
 * Theme bakedCssUrl 절대화 헬퍼
 *
 * DB의 themes.baked_css_url 정책 (2026-05-03 P1-#7):
 *   - 절대 URL (Blob CDN)  → 그대로 응답
 *   - NULL                 → 환경별 base URL로 폴백 절대화 (`{PUBLIC_API_BASE_URL}/themes/css/{slug}`)
 *
 * 상대 경로(`/api/themes/css/...`)는 더 이상 DB에 박제하지 않는다.
 * 응답 시점에 server가 단일 환경변수(PUBLIC_API_BASE_URL)로 절대화하여 web에 전달한다.
 *
 * 참조: reports/sprint-baked-css-url-absolute-progress.md §2-2 방향 B
 */

/**
 * 환경별 PUBLIC_API_BASE_URL을 반환한다 (env.validation.ts에서 부팅 시 검증됨).
 *
 * 본 helper는 controller가 process.env에 직접 접근하지 않도록 lib 레이어에 캡슐화한다.
 * (Constitution P19 — controller boundary에서 env 직접 접근 금지)
 */
export function getPublicApiBaseUrl(): string {
  return process.env.PUBLIC_API_BASE_URL ?? ''
}

/**
 * baked_css_url DB 값을 응답용 절대 URL로 변환한다.
 *
 * @param dbValue DB에 박제된 baked_css_url (절대 URL 또는 NULL)
 * @param authorSlug 작가 슬러그 (폴백 URL 구성용)
 * @param publicApiBaseUrl 환경별 API base URL (예: `http://localhost:3000/api`)
 * @returns 절대 URL (Blob URL 그대로 또는 폴백 절대 URL)
 */
export function resolveBakedCssUrl(
  dbValue: string | null,
  authorSlug: string,
  publicApiBaseUrl: string,
): string {
  // 절대 URL이면 그대로 반환 (Blob CDN)
  if (dbValue && /^https?:\/\//.test(dbValue)) {
    return dbValue
  }
  // NULL 또는 비절대 → 환경별 폴백 절대 URL
  const base = publicApiBaseUrl.replace(/\/$/, '')
  return `${base}/themes/css/${authorSlug}`
}
