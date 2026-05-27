import { GcsStorageService } from './gcs-storage.service'

/**
 * GcsStorageService 유닛 테스트.
 *
 * `@google-cloud/storage` 의 Storage/Bucket/File을 jest mock으로 치환하여
 * BlobStoragePort 계약(uploadImage / uploadThemeCss / deleteImage / isEnabled)을 검증.
 *
 * 통합(실 GCS 호출) 테스트는 본 sprint 범위 외(Phase 4-5에서 dev 사이트 직접 베이킹/업로드 1건 검증).
 */

// `Storage`를 jest로 모킹 — 생성자 호출 + bucket().file().save()/delete() 체인 모킹
const mockSave = jest.fn().mockResolvedValue([])
const mockDelete = jest.fn().mockResolvedValue([])
const mockFile = jest.fn().mockReturnValue({ save: mockSave, delete: mockDelete })
const mockBucket = jest.fn().mockReturnValue({ file: mockFile })

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: mockBucket,
  })),
}))

describe('GcsStorageService', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    mockSave.mockClear()
    mockDelete.mockClear()
    mockFile.mockClear()
    mockBucket.mockClear()
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  describe('초기화 + isEnabled()', () => {
    it('GCS_BUCKET 환경변수 미설정 시 isEnabled()=false', () => {
      delete process.env.GCS_BUCKET
      const svc = new GcsStorageService()
      expect(svc.isEnabled()).toBe(false)
    })

    it('GCS_BUCKET 설정 시 isEnabled()=true (Storage + bucket 호출)', () => {
      process.env.GCS_BUCKET = 'grimoire-blob-dev'
      const svc = new GcsStorageService()
      expect(svc.isEnabled()).toBe(true)
      expect(mockBucket).toHaveBeenCalledWith('grimoire-blob-dev')
    })
  })

  describe('uploadImage()', () => {
    it('미설정 시 throw', async () => {
      delete process.env.GCS_BUCKET
      const svc = new GcsStorageService()
      await expect(svc.uploadImage(Buffer.from('x'), 'a.png', 'image/png')).rejects.toThrow(
        'GCS Storage가 설정되지 않았습니다',
      )
    })

    it('객체 경로 covers/{timestamp}-{filename} + 공개 URL 반환', async () => {
      process.env.GCS_BUCKET = 'grimoire-blob-dev'
      const svc = new GcsStorageService()
      const buf = Buffer.from('image-data')
      const url = await svc.uploadImage(buf, 'cover.png', 'image/png')

      // 호출 검증 — file 인자 = `covers/{timestamp}-cover.png`
      expect(mockFile).toHaveBeenCalledTimes(1)
      const objectName = mockFile.mock.calls[0][0] as string
      expect(objectName).toMatch(/^covers\/\d+-cover\.png$/)

      // save 인자 검증 — buffer + contentType + resumable=false
      expect(mockSave).toHaveBeenCalledWith(buf, {
        contentType: 'image/png',
        resumable: false,
      })

      // 응답 URL 검증
      expect(url).toMatch(/^https:\/\/storage\.googleapis\.com\/grimoire-blob-dev\/covers\/\d+-cover\.png$/)
    })

    it('filename의 위험 문자(공백/슬래시/한글)는 _로 sanitize', async () => {
      process.env.GCS_BUCKET = 'grimoire-blob-dev'
      const svc = new GcsStorageService()
      await svc.uploadImage(Buffer.from('x'), '한 글 /../etc/passwd', 'image/png')

      const objectName = mockFile.mock.calls[0][0] as string
      // covers/ 접두사 + 타임스탬프 후 본 파일명에 영문/숫자/`._-` 외 문자가 없는지
      const body = objectName.replace(/^covers\/\d+-/, '')
      expect(body).toMatch(/^[a-zA-Z0-9._-]+$/)
    })
  })

  describe('uploadThemeCss()', () => {
    it('미설정 시 throw', async () => {
      delete process.env.GCS_BUCKET
      const svc = new GcsStorageService()
      await expect(svc.uploadThemeCss('body{}', 'deerdevil')).rejects.toThrow(
        'GCS Storage가 설정되지 않았습니다',
      )
    })

    it('객체 경로 themes/{slug}.css + cacheControl + text/css 박제', async () => {
      process.env.GCS_BUCKET = 'grimoire-blob-prod'
      const svc = new GcsStorageService()
      const url = await svc.uploadThemeCss(':root { --bg: #000; }', 'deerdevil')

      expect(mockFile).toHaveBeenCalledWith('themes/deerdevil.css')
      expect(mockSave).toHaveBeenCalledWith(expect.any(Buffer), {
        contentType: 'text/css; charset=utf-8',
        metadata: { cacheControl: 'public, max-age=3600' },
        resumable: false,
      })
      expect(url).toBe('https://storage.googleapis.com/grimoire-blob-prod/themes/deerdevil.css')
    })

    it('authorSlug의 위험 문자는 _로 sanitize (덮어쓰기 시 충돌 방지)', async () => {
      process.env.GCS_BUCKET = 'grimoire-blob-dev'
      const svc = new GcsStorageService()
      await svc.uploadThemeCss('body{}', '../../malicious slug')

      const objectName = mockFile.mock.calls[0][0] as string
      expect(objectName).toMatch(/^themes\/[a-zA-Z0-9_-]+\.css$/)
      expect(objectName).not.toContain('..')
      expect(objectName).not.toContain('/malicious')
    })
  })

  describe('deleteImage()', () => {
    it('미설정 시 silently no-op (throw 0건)', async () => {
      delete process.env.GCS_BUCKET
      const svc = new GcsStorageService()
      await expect(svc.deleteImage('https://storage.googleapis.com/x/y')).resolves.toBeUndefined()
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('자기 bucket prefix 정합 URL만 삭제 (다른 origin 무시)', async () => {
      process.env.GCS_BUCKET = 'grimoire-blob-dev'
      const svc = new GcsStorageService()
      const url = 'https://storage.googleapis.com/grimoire-blob-dev/covers/123-cover.png'
      await svc.deleteImage(url)

      expect(mockFile).toHaveBeenCalledWith('covers/123-cover.png')
      expect(mockDelete).toHaveBeenCalledWith({ ignoreNotFound: true })
    })

    it('타 bucket / Azure Blob URL은 무시 (no-op + 로그만)', async () => {
      process.env.GCS_BUCKET = 'grimoire-blob-dev'
      const svc = new GcsStorageService()
      await svc.deleteImage('https://grimoire0storage.blob.core.windows.net/covers/x.png')

      expect(mockFile).not.toHaveBeenCalled()
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('GCS 삭제 중 예외 발생해도 throw 0건 (best-effort)', async () => {
      process.env.GCS_BUCKET = 'grimoire-blob-dev'
      mockDelete.mockRejectedValueOnce(new Error('network'))
      const svc = new GcsStorageService()
      await expect(
        svc.deleteImage('https://storage.googleapis.com/grimoire-blob-dev/covers/x.png'),
      ).resolves.toBeUndefined()
    })
  })
})
