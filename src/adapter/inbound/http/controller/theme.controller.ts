import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Response } from 'express'
import { GenerateThemeUseCase } from '@application/theme/generate-theme.usecase'
import { GetThemeUseCase } from '@application/theme/get-theme.usecase'
import { BakeThemeUseCase } from '@application/theme/bake-theme.usecase'
import { GenerateThemeDto } from '../dto/theme.dto'
import { bakeThemeToCSS } from '@lib/theme-baker'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('themes')
export class ThemeController {
  constructor(
    private readonly generateTheme: GenerateThemeUseCase,
    private readonly getTheme: GetThemeUseCase,
    private readonly bakeTheme: BakeThemeUseCase,
  ) {}

  @Throttle({ default: { ttl: 60000, limit: 5 } })  // AI API 호출 — 분당 5회
  @Post('generate')
  @UseGuards(JwtAuthGuard)
  async generate(@Req() req: any, @Body() dto: GenerateThemeDto) {
    // 인증된 사용자만 자신의 테마를 생성할 수 있음
    const theme = await this.generateTheme.execute(dto.authorId, dto.description)
    return { themeId: theme.id, preview: theme.overrides }
  }

  /** 테마를 CSS로 베이킹하고 bakedCssUrl을 갱신한다 (소유권 검증) */
  @Post('publish/:authorSlug')
  @UseGuards(JwtAuthGuard)
  async publish(@Req() req: any, @Param('authorSlug') authorSlug: string) {
    // 소유권 검증: 요청자의 slug와 authorSlug 일치 확인
    if (req.user.slug !== authorSlug) {
      throw new ForbiddenException('본인의 테마만 퍼블리시할 수 있습니다')
    }
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
