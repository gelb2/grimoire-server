import { Injectable, Inject, NotFoundException } from '@nestjs/common'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { Theme } from '@domain/model/theme'

@Injectable()
export class GetThemeUseCase {
  constructor(
    @Inject('ThemeRepositoryPort') private readonly themeRepo: ThemeRepositoryPort,
  ) {}

  async execute(authorSlug: string): Promise<Theme> {
    const theme = await this.themeRepo.findByAuthorSlug(authorSlug)
    if (!theme) {
      throw new NotFoundException('테마를 찾을 수 없습니다')
    }
    return theme
  }
}
