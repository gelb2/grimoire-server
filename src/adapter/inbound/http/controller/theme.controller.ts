import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import { GenerateThemeUseCase } from '@application/theme/generate-theme.usecase'
import { GetThemeUseCase } from '@application/theme/get-theme.usecase'
import { GenerateThemeDto } from '../dto/theme.dto'

@Controller('themes')
export class ThemeController {
  constructor(
    private readonly generateTheme: GenerateThemeUseCase,
    private readonly getTheme: GetThemeUseCase,
  ) {}

  @Post('generate')
  async generate(@Body() dto: GenerateThemeDto) {
    const theme = await this.generateTheme.execute(dto.authorId, dto.description)
    return { themeId: theme.id, preview: theme.overrides }
  }

  @Get(':authorSlug')
  async findByAuthorSlug(@Param('authorSlug') authorSlug: string) {
    return this.getTheme.execute(authorSlug)
  }
}
