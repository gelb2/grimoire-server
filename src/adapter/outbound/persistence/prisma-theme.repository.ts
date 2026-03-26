import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { AuthorTheme, Theme } from '@domain/model/theme'

@Injectable()
export class PrismaThemeRepository implements ThemeRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByAuthorId(authorId: string): Promise<Theme | null> {
    const row = await this.prisma.theme.findUnique({ where: { authorId } })
    return row ? toDomain(row) : null
  }

  async findByAuthorSlug(slug: string): Promise<Theme | null> {
    const author = await this.prisma.author.findUnique({
      where: { slug },
      include: { theme: true },
    })
    if (!author?.theme) return null
    return toDomain(author.theme)
  }

  async upsert(
    authorId: string,
    preset: string,
    overrides: AuthorTheme,
    rawDescription: string,
  ): Promise<Theme> {
    const row = await this.prisma.theme.upsert({
      where: { authorId },
      create: {
        authorId,
        preset,
        overrides: overrides as object,
        rawDescription,
      },
      update: {
        preset,
        overrides: overrides as object,
        rawDescription,
      },
    })
    return toDomain(row)
  }

  async updateBakedCssUrl(authorId: string, url: string): Promise<void> {
    await this.prisma.theme.update({
      where: { authorId },
      data: { bakedCssUrl: url },
    })
  }
}

function toDomain(row: {
  id: string
  authorId: string
  preset: string
  overrides: unknown
  rawDescription: string | null
  bakedCssUrl: string | null
  updatedAt: Date
}): Theme {
  return {
    id: row.id,
    authorId: row.authorId,
    preset: row.preset,
    overrides: row.overrides as AuthorTheme | null,
    rawDescription: row.rawDescription,
    bakedCssUrl: row.bakedCssUrl,
    updatedAt: row.updatedAt,
  }
}
