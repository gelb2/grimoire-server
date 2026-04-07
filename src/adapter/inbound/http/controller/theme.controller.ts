import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import {
  Controller,
  Get,
  Post,
  Delete,
  Put,
  Body,
  Param,
  Query,
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
import { ThemeSlotUseCase } from '@application/theme/theme-slot.usecase'
import { GenerateThemeDto } from '../dto/theme.dto'
import { bakeThemeToCSS } from '@lib/theme-baker'
import { resolveTheme } from '@domain/model/theme-presets'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('themes')
export class ThemeController {
  constructor(
    private readonly generateTheme: GenerateThemeUseCase,
    private readonly getTheme: GetThemeUseCase,
    private readonly bakeTheme: BakeThemeUseCase,
    private readonly themeSlot: ThemeSlotUseCase,
  ) {}

  /** 시스템 프리셋 목록 조회 (인증 불요) */
  @Get('presets')
  listPresets() {
    return this.generateTheme.listPresets()
  }

  /** 프리셋으로 테마 생성 (크레딧 소모 없음) */
  @Post('from-preset')
  @UseGuards(JwtAuthGuard)
  async createFromPreset(@Req() req: AuthenticatedRequest, @Body() body: { preset: string; name?: string }) {
    const theme = await this.generateTheme.createFromPreset(req.user.sub, body.preset, body.name)
    return { themeId: theme.id, preset: theme.preset, name: theme.name }
  }

  /** 테마 AI 생성 (슬롯 체크 포함) */
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('generate')
  @UseGuards(JwtAuthGuard)
  async generate(@Req() req: AuthenticatedRequest, @Body() dto: GenerateThemeDto) {
    // IDOR 방지: body의 authorId 대신 JWT의 sub 사용
    const theme = await this.generateTheme.execute(req.user.sub, dto.description, dto.name)
    return { themeId: theme.id, preview: theme.overrides }
  }

  /** 내 테마 목록 조회 */
  @Get('mine')
  @UseGuards(JwtAuthGuard)
  async listMine(@Req() req: AuthenticatedRequest) {
    return this.getTheme.listByAuthor(req.user.sub)
  }

  /** 테마 커스텀 수정 (overrides 업데이트) */
  @Put(':themeId')
  @UseGuards(JwtAuthGuard)
  async updateTheme(@Req() req: AuthenticatedRequest, @Param('themeId') themeId: string, @Body() body: { overrides: any }) {
    const theme = await this.getTheme.updateOverrides(req.user.sub, themeId, body.overrides)
    return { themeId: theme.id, overrides: theme.overrides }
  }

  /** 테마 삭제 (슬롯 반환) */
  @Delete(':themeId')
  @UseGuards(JwtAuthGuard)
  async deleteTheme(@Req() req: AuthenticatedRequest, @Param('themeId') themeId: string) {
    await this.getTheme.deleteTheme(req.user.sub, themeId)
    return { deleted: true }
  }

  /** 테마를 슬롯에 배치 */
  @Post(':themeId/slot')
  @UseGuards(JwtAuthGuard)
  async assignSlot(@Req() req: AuthenticatedRequest, @Param('themeId') themeId: string) {
    const theme = await this.themeSlot.assignSlot(req.user.sub, themeId)
    return { themeId: theme.id, isSlotted: theme.isSlotted }
  }

  /** 테마를 슬롯에서 제거 */
  @Delete(':themeId/slot')
  @UseGuards(JwtAuthGuard)
  async removeFromSlot(@Req() req: AuthenticatedRequest, @Param('themeId') themeId: string) {
    const theme = await this.themeSlot.removeFromSlot(req.user.sub, themeId)
    return { themeId: theme.id, isSlotted: theme.isSlotted }
  }

  /** 슬롯 현황 조회 */
  @Get('slots/info')
  @UseGuards(JwtAuthGuard)
  async getSlotInfo(@Req() req: AuthenticatedRequest) {
    return this.themeSlot.getSlotInfo(req.user.sub)
  }

  /** 개별 테마 상세 조회 (인증 필수, 소유권 확인) */
  @Get('detail/:themeId')
  @UseGuards(JwtAuthGuard)
  async getThemeById(@Req() req: AuthenticatedRequest, @Param('themeId') themeId: string) {
    const theme = await this.getTheme.findById(req.user.sub, themeId)
    const resolved = resolveTheme(theme.preset, theme.overrides as Record<string, unknown> | null)
    return { ...theme, authorId: undefined, theme: resolved }
  }

  /** 테마를 CSS로 베이킹 */
  @Post('publish/:authorSlug')
  @UseGuards(JwtAuthGuard)
  async publish(@Req() req: AuthenticatedRequest, @Param('authorSlug') authorSlug: string) {
    if (req.user.slug !== authorSlug) {
      throw new ForbiddenException('본인의 테마만 퍼블리시할 수 있습니다')
    }
    return this.bakeTheme.execute(authorSlug)
  }

  /** 테마 CSS 반환 */
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

  /** 작품별 테마 resolve (public) */
  @Get('resolve/:authorSlug')
  async resolveTheme(
    @Param('authorSlug') authorSlug: string,
    @Query('work') workSlug?: string,
  ) {
    const theme = await this.getTheme.resolve(authorSlug, workSlug)
    return theme ?? {}
  }

  /** 작가 기본 테마 조회 — preset + overrides merge한 완전한 theme 반환 */
  @Get(':authorSlug')
  async findByAuthorSlug(@Param('authorSlug') authorSlug: string) {
    const theme = await this.getTheme.execute(authorSlug)
    const { authorId, ...safe } = theme as any
    // preset 기반으로 완전한 테마 객체 생성 (프론트는 이 값을 그대로 사용)
    const resolved = resolveTheme(theme.preset, theme.overrides as Record<string, unknown> | null)
    return { ...safe, theme: resolved }
  }
}
