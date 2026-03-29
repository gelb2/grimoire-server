/** Blob 스토리지 포트 — 파일 업로드/삭제 추상화 */
export interface BlobStoragePort {
  /** 이미지 업로드 → 공개 URL 반환 */
  uploadImage(buffer: Buffer, filename: string, mimeType: string): Promise<string>
  /** 이미지 삭제 */
  deleteImage(url: string): Promise<void>
  /** 스토리지 활성화 여부 (환경변수 미설정 시 false) */
  isEnabled(): boolean
}
