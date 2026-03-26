import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
  NotFoundException,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Response } from 'express'
import { GenerateThemeUseCase } from '@application/theme/generate-theme.usecase'
import { GetThemeUseCase } from '@application/theme/get-theme.usecase'
import { BakeThemeUseCase } from '@application/theme/bake-theme.usecase'
import { GenerateThemeDto } from '../dto/theme.dto'
import { bakeThemeToCSS } from '@lib/theme-baker'

@Controller('themes')
export class ThemeController {
  constructor(
    private readonly generateTheme: GenerateThemeUseCase,
    private readonly getTheme: GetThemeUseCase,
    private readonly bakeTheme: BakeThemeUseCase,
  ) {}

  @Throttle({ default: { ttl: 60000, limit: 5 } })  // AI API 호출 — 분당 5회
  @Post('generate')
  async generate(@Body() dto: GenerateThemeDto) {
    const theme = await this.generateTheme.execute(dto.authorId, dto.description)
    return { themeId: theme.id, preview: theme.overrides }
  }

  /** 테마를 CSS로 베이킹하고 bakedCssUrl을 갱신한다 */
  @Post('publish/:authorSlug')
  async publish(@Param('authorSlug') authorSlug: string) {
    return this.bakeTheme.execute(authorSlug)
  }

  /** 작가 테마를 CSS로 즉시 생성하여 반환한다 */
  @Get('css/:authorSlug')
  async getThemeCSS(
    @Param('authorSlug') authorSlug: string,
    @Res() res: Response,
  ) {
    const theme = await this.getTheme.execute(authorSlug)
    if (!theme) {
      throw new NotFoundException('테마를 찾을 수 없습니다')
    }
    const css = bakeThemeToCSS(theme.overrides || {}, authorSlug)
    res.type('text/css').send(css)
  }

  @Get(':authorSlug')
  async findByAuthorSlug(@Param('authorSlug') authorSlug: string) {
    return this.getTheme.execute(authorSlug)
  }
}
