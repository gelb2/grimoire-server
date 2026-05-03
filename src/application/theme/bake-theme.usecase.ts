import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { BlobStoragePort } from '@domain/port/outbound/blob-storage.port'
import { bakeThemeToCSS } from '@lib/theme-baker'

/** 테마를 CSS로 변환하고 CDN에 업로드하는 유스케이스 */
@Injectable()
export class BakeThemeUseCase {
  private readonly logger = new Logger(BakeThemeUseCase.name)

  constructor(
    @Inject('ThemeRepositoryPort')
    private readonly themeRepo: ThemeRepositoryPort,
    @Inject('BlobStoragePort')
    private readonly blobStorage: BlobStoragePort,
  ) {}

  /**
   * 작가 슬러그로 테마를 조회하여 CSS를 생성하고 CDN에 업로드한다.
   *
   * 박제 정책 (2026-05-03 P1-#7, sprint-baked-css-url-absolute):
   *   - Blob 활성 + 업로드 성공 → 절대 URL(Blob CDN) 박제
   *   - Blob 비활성 또는 업로드 실패 → NULL 박제
   *     (응답 시점에 server가 환경별 base URL로 동적 절대화)
   *
   * 상대 경로(`/api/themes/css/...`) DB 박제는 더 이상 하지 않는다.
   * 환경 전환(localhost ↔ dev ↔ prod) 시 stale 박제 무효 0건 보장.
   */
  async execute(
    authorSlug: string,
  ): Promise<{ cssUrl: string | null; css: string }> {
    const theme = await this.themeRepo.findByAuthorSlug(authorSlug)
    if (!theme) {
      throw new NotFoundException('테마를 찾을 수 없습니다')
    }

    const css = bakeThemeToCSS(theme.overrides || {}, authorSlug)

    let cssUrl: string | null = null

    if (this.blobStorage.isEnabled()) {
      try {
        cssUrl = await this.blobStorage.uploadThemeCss(css, authorSlug)
        this.logger.log(`테마 CSS CDN 업로드 완료: ${authorSlug}`)
      } catch (err) {
        this.logger.warn(`CDN 업로드 실패, NULL 박제 (응답 시 server 폴백): ${String(err)}`)
        cssUrl = null
      }
    } else {
      // Blob 비활성 → NULL 박제 (응답 시 server가 환경별 base URL로 절대화)
      cssUrl = null
    }

    await this.themeRepo.updateBakedCssUrl(theme.id, cssUrl)

    return { cssUrl, css }
  }
}
