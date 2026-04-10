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
   * Blob Storage 미설정 시 API 폴백 URL을 반환한다.
   */
  async execute(
    authorSlug: string,
  ): Promise<{ cssUrl: string; css: string }> {
    const theme = await this.themeRepo.findByAuthorSlug(authorSlug)
    if (!theme) {
      throw new NotFoundException('테마를 찾을 수 없습니다')
    }

    const css = bakeThemeToCSS(theme.overrides || {}, authorSlug)

    let cssUrl: string

    if (this.blobStorage.isEnabled()) {
      try {
        cssUrl = await this.blobStorage.uploadThemeCss(css, authorSlug)
        this.logger.log(`테마 CSS CDN 업로드 완료: ${authorSlug}`)
      } catch (err) {
        this.logger.warn(`CDN 업로드 실패, API 폴백: ${String(err)}`)
        cssUrl = `/api/themes/css/${authorSlug}`
      }
    } else {
      cssUrl = `/api/themes/css/${authorSlug}`
    }

    await this.themeRepo.updateBakedCssUrl(theme.id, cssUrl)

    return { cssUrl, css }
  }
}
