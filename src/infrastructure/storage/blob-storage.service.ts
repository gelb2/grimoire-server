import { Injectable, Logger } from '@nestjs/common'
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob'
import { BlobStoragePort } from '@domain/port/outbound/blob-storage.port'

/** Azure Blob Storage 업로드 서비스 — BlobStoragePort 구현 */
@Injectable()
export class BlobStorageService implements BlobStoragePort {
  private readonly logger = new Logger(BlobStorageService.name)
  private blobServiceClient: BlobServiceClient | null = null
  private readonly containerName = 'covers'

  constructor() {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY

    if (accountName && accountKey) {
      const credential = new StorageSharedKeyCredential(accountName, accountKey)
      this.blobServiceClient = new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        credential,
      )
    } else {
      this.logger.warn('Azure Storage 환경변수 미설정 — 커버 이미지 업로드 비활성화')
    }
  }

  isEnabled(): boolean {
    return this.blobServiceClient !== null
  }

  /** 이미지 버퍼를 Blob에 업로드하고 공개 URL을 반환 */
  async uploadImage(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    if (!this.blobServiceClient) {
      throw new Error('Azure Storage가 설정되지 않았습니다')
    }

    const containerClient = this.blobServiceClient.getContainerClient(this.containerName)

    // 컨테이너가 없으면 생성 (public 읽기 허용)
    await containerClient.createIfNotExists({ access: 'blob' })

    const blobName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const blockBlobClient = containerClient.getBlockBlobClient(blobName)

    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: mimeType },
    })

    return blockBlobClient.url
  }

  /** 테마 CSS를 Blob에 업로드하고 CDN URL을 반환 */
  async uploadThemeCss(css: string, authorSlug: string): Promise<string> {
    if (!this.blobServiceClient) {
      throw new Error('Azure Storage가 설정되지 않았습니다')
    }

    const containerClient = this.blobServiceClient.getContainerClient('themes')
    await containerClient.createIfNotExists({ access: 'blob' })

    // 작가별 고정 파일명 — 덮어쓰기로 항상 최신 유지
    const safeName = authorSlug.replace(/[^a-zA-Z0-9_-]/g, '_')
    const blobName = `${safeName}.css`
    const blockBlobClient = containerClient.getBlockBlobClient(blobName)

    const buffer = Buffer.from(css, 'utf-8')
    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: {
        blobContentType: 'text/css; charset=utf-8',
        blobCacheControl: 'public, max-age=3600',
      },
    })

    return blockBlobClient.url
  }

  /** Blob 삭제 (이전 커버 교체 시) */
  async deleteImage(url: string): Promise<void> {
    if (!this.blobServiceClient) return

    try {
      const blobName = url.split('/').pop()
      if (!blobName) return

      const containerClient = this.blobServiceClient.getContainerClient(this.containerName)
      await containerClient.deleteBlob(blobName)
    } catch (err) {
      this.logger.warn(`Blob 삭제 실패 (무시): ${url}`, err)
    }
  }
}
