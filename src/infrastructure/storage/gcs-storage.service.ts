import { Injectable, Logger } from '@nestjs/common'
import { Storage, Bucket } from '@google-cloud/storage'
import { BlobStoragePort } from '@domain/port/outbound/blob-storage.port'

/**
 * Google Cloud Storage 업로드 서비스 — BlobStoragePort 구현
 *
 * 신설 (2026-05-27, GCP migration Phase 4-3): Azure Blob Storage adapter 대체.
 * Hexagonal port(`BlobStoragePort`) 인터페이스 그대로 — 도메인/UseCase 영향 0건.
 *
 * 인증: Application Default Credentials (ADC).
 *  - 로컬: `gcloud auth application-default login` 또는 GOOGLE_APPLICATION_CREDENTIALS 환경변수
 *  - Cloud Run: 자동 attach된 service account 사용 (명시 credential file 0건)
 *
 * 명명 관행: Azure container("covers"/"themes") = GCS object prefix (동일 명명, URL 호환).
 *  - 이미지: gs://{bucket}/covers/{timestamp}-{filename}
 *  - 테마 CSS: gs://{bucket}/themes/{authorSlug}.css
 *  - 공개 URL: https://storage.googleapis.com/{bucket}/covers/...
 *
 * bucket: env GCS_BUCKET (예: grimoire-blob-dev / grimoire-blob-prod).
 *  - region asia-northeast1, uniform-bucket-level-access ON (Phase 0 P0-4 박제).
 *  - 공개 access는 bucket-level IAM(`allUsers` → `objectViewer`)로 별도 부여 (코드 측 ACL 설정 0건).
 */
@Injectable()
export class GcsStorageService implements BlobStoragePort {
  private readonly logger = new Logger(GcsStorageService.name)
  private storage: Storage | null = null
  private bucket: Bucket | null = null
  private readonly bucketName: string | undefined
  private readonly coversPrefix = 'covers'
  private readonly themesPrefix = 'themes'

  constructor() {
    this.bucketName = process.env.GCS_BUCKET

    if (this.bucketName) {
      // ADC (Application Default Credentials) — Cloud Run 자동, 로컬은 gcloud auth
      this.storage = new Storage()
      this.bucket = this.storage.bucket(this.bucketName)
      this.logger.log(`GCS Storage 활성화 — bucket=${this.bucketName}`)
    } else {
      this.logger.warn('GCS_BUCKET 환경변수 미설정 — 커버/테마 업로드 비활성화')
    }
  }

  isEnabled(): boolean {
    return this.bucket !== null
  }

  /** 이미지 버퍼를 GCS에 업로드하고 공개 URL을 반환 */
  async uploadImage(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    if (!this.bucket || !this.bucketName) {
      throw new Error('GCS Storage가 설정되지 않았습니다')
    }

    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const objectName = `${this.coversPrefix}/${Date.now()}-${safeFilename}`
    const file = this.bucket.file(objectName)

    await file.save(buffer, {
      contentType: mimeType,
      resumable: false,
    })

    // 공개 URL — uniform bucket-level access 정합 (서명 X, IAM allUsers:objectViewer 가정)
    return `https://storage.googleapis.com/${this.bucketName}/${objectName}`
  }

  /** 테마 CSS를 GCS에 업로드하고 CDN URL을 반환 (작가별 고정 파일명 — 덮어쓰기) */
  async uploadThemeCss(css: string, authorSlug: string): Promise<string> {
    if (!this.bucket || !this.bucketName) {
      throw new Error('GCS Storage가 설정되지 않았습니다')
    }

    const safeName = authorSlug.replace(/[^a-zA-Z0-9_-]/g, '_')
    const objectName = `${this.themesPrefix}/${safeName}.css`
    const file = this.bucket.file(objectName)

    const buffer = Buffer.from(css, 'utf-8')
    await file.save(buffer, {
      contentType: 'text/css; charset=utf-8',
      metadata: {
        cacheControl: 'public, max-age=3600',
      },
      resumable: false,
    })

    return `https://storage.googleapis.com/${this.bucketName}/${objectName}`
  }

  /** GCS 객체 삭제 (이전 커버 교체 시) */
  async deleteImage(url: string): Promise<void> {
    if (!this.bucket || !this.bucketName) return

    try {
      // URL → objectName 추출 — https://storage.googleapis.com/{bucket}/{objectName}
      // covers/timestamp-filename 패턴 (uploadImage 박제와 정합)
      const prefix = `https://storage.googleapis.com/${this.bucketName}/`
      if (!url.startsWith(prefix)) {
        this.logger.warn(`GCS 외 URL 삭제 요청 (무시): ${url}`)
        return
      }
      const objectName = url.substring(prefix.length)
      if (!objectName) return

      await this.bucket.file(objectName).delete({ ignoreNotFound: true })
    } catch (err) {
      this.logger.warn(`GCS 객체 삭제 실패 (무시): ${url}`, err)
    }
  }
}
