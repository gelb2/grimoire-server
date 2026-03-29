import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { AuthorTheme, Theme } from '@domain/model/theme'

@Injectable()
export class PrismaThemeRepository implements ThemeRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Theme | null> {
    const row = await this.prisma.theme.findUnique({ where: { id } })
    return row ? toDomain(row) : null
  }

  async findAllByAuthorId(authorId: string): Promise<Theme[]> {
    const rows = await this.prisma.theme.findMany({
      where: { authorId },
      orderBy: { updatedAt: 'desc' },
    })
    return rows.map(toDomain)
  }

  async findByAuthorSlug(slug: string): Promise<Theme | null> {
    // 작가의 defaultThemeId로 기본 테마 조회
    const author = await this.prisma.author.findUnique({
      where: { slug },
      select: { defaultThemeId: true },
    })
    if (!author?.defaultThemeId) {
      // defaultThemeId 없으면 첫 번째 테마 반환 (하위 호환)
      const firstTheme = await this.prisma.theme.findFirst({
        where: { author: { slug } },
        orderBy: { updatedAt: 'desc' },
      })
      return firstTheme ? toDomain(firstTheme) : null
    }
    const theme = await this.prisma.theme.findUnique({ where: { id: author.defaultThemeId } })
    return theme ? toDomain(theme) : null
  }

  async countByAuthorId(authorId: string): Promise<number> {
    return this.prisma.theme.count({ where: { authorId } })
  }

  async create(
    authorId: string,
    name: string,
    preset: string,
    overrides: AuthorTheme,
    rawDescription: string,
  ): Promise<Theme> {
    const row = await this.prisma.theme.create({
      data: {
        authorId,
        name,
        preset,
        overrides: overrides as object,
        rawDescription,
      },
    })
    return toDomain(row)
  }

  async update(
    themeId: string,
    preset: string,
    overrides: AuthorTheme,
    rawDescription: string,
  ): Promise<Theme> {
    const row = await this.prisma.theme.update({
      where: { id: themeId },
      data: {
        preset,
        overrides: overrides as object,
        rawDescription,
      },
    })
    return toDomain(row)
  }

  async delete(themeId: string): Promise<void> {
    // 이 테마를 참조하는 작품의 themeId를 null로 해제
    await this.prisma.work.updateMany({
      where: { themeId },
      data: { themeId: null },
    })
    await this.prisma.theme.delete({ where: { id: themeId } })
  }

  async updateBakedCssUrl(themeId: string, url: string): Promise<void> {
    await this.prisma.theme.update({
      where: { id: themeId },
      data: { bakedCssUrl: url },
    })
  }
}

function toDomain(row: {
  id: string
  authorId: string
  name: string
  preset: string
  overrides: unknown
  rawDescription: string | null
  bakedCssUrl: string | null
  updatedAt: Date
}): Theme {
  return {
    id: row.id,
    authorId: row.authorId,
    name: row.name,
    preset: row.preset,
    overrides: row.overrides as AuthorTheme | null,
    rawDescription: row.rawDescription,
    bakedCssUrl: row.bakedCssUrl,
    updatedAt: row.updatedAt,
  }
}
