import { resolveBakedCssUrl } from './url-resolver'

describe('resolveBakedCssUrl', () => {
  const BASE_LOCALHOST = 'http://localhost:3000/api'
  const BASE_DEV = 'https://dev-api.grimoire-book.com/api'

  it('NULL 입력 → 환경별 폴백 절대 URL 반환 (localhost)', () => {
    const result = resolveBakedCssUrl(null, 'deerdevil', BASE_LOCALHOST)
    expect(result).toBe('http://localhost:3000/api/themes/css/deerdevil')
  })

  it('NULL 입력 → 환경별 폴백 절대 URL 반환 (dev)', () => {
    const result = resolveBakedCssUrl(null, 'deerdevil', BASE_DEV)
    expect(result).toBe('https://dev-api.grimoire-book.com/api/themes/css/deerdevil')
  })

  it('https 절대 URL 입력 → 그대로 반환 (Blob CDN)', () => {
    const blobUrl = 'https://grimoire0storage.blob.core.windows.net/themes/deerdevil.css'
    const result = resolveBakedCssUrl(blobUrl, 'deerdevil', BASE_LOCALHOST)
    expect(result).toBe(blobUrl)
  })

  it('http 절대 URL 입력 → 그대로 반환', () => {
    const httpUrl = 'http://example.com/themes/foo.css'
    const result = resolveBakedCssUrl(httpUrl, 'deerdevil', BASE_LOCALHOST)
    expect(result).toBe(httpUrl)
  })

  it('PUBLIC_API_BASE_URL 트레일링 슬래시 정규화', () => {
    const result = resolveBakedCssUrl(null, 'deerdevil', 'http://localhost:3000/api/')
    expect(result).toBe('http://localhost:3000/api/themes/css/deerdevil')
  })

  it('빈 문자열(스테일) 입력도 폴백 처리', () => {
    const result = resolveBakedCssUrl('', 'deerdevil', BASE_LOCALHOST)
    expect(result).toBe('http://localhost:3000/api/themes/css/deerdevil')
  })

  it('상대 경로(stale) 입력 시에도 폴백 절대화 (방어적)', () => {
    // 마이그레이션 전 잔존 row가 있다면 절대 URL이 아니므로 폴백
    const result = resolveBakedCssUrl('/api/themes/css/deerdevil', 'deerdevil', BASE_LOCALHOST)
    expect(result).toBe('http://localhost:3000/api/themes/css/deerdevil')
  })

  it('authorSlug에 특수문자 없을 때 안전 결합', () => {
    const result = resolveBakedCssUrl(null, 'author-1', BASE_LOCALHOST)
    expect(result).toBe('http://localhost:3000/api/themes/css/author-1')
  })
})
