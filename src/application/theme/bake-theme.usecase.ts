import { Injectable, Inject, NotFoundException } from '@nestjs/common'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { bakeThemeToCSS } from '@lib/theme-baker'

/** 테마를 CSS로 변환하고 bakedCssUrl을 갱신하는 유스케이스 */
@Injectable()
export class BakeThemeUseCase {
  constructor(
    @Inject('ThemeRepositoryPort')
    private readonly themeRepo: ThemeRepositoryPort,
  ) {}

  /**
   * 작가 슬러그로 테마를 조회하여 CSS를 생성하고, bakedCssUrl을 DB에 저장한다
   * @returns { cssUrl, css } — 생성된 CSS URL과 CSS 문자열
   */
  async execute(
    authorSlug: string,
  ): Promise<{ cssUrl: string; css: string }> {
    const theme = await this.themeRepo.findByAuthorSlug(authorSlug)
    if (!theme) {
      throw new NotFoundException('테마를 찾을 수 없습니다')
    }

    const css = bakeThemeToCSS(theme.overrides || {}, authorSlug)
    const cssUrl = `/api/themes/css/${authorSlug}`

    // DB에 bakedCssUrl 기록
    await this.themeRepo.updateBakedCssUrl(theme.authorId, cssUrl)

    return { cssUrl, css }
  }
}
