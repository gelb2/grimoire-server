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
    // 생성 순 오름차순 — 사용자가 슬롯 토글/편집해도 순서가 출렁이지 않게
    const rows = await this.prisma.theme.findMany({
      where: { authorId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toDomain)
  }

  async findByAuthorSlug(slug: string): Promise<Theme | null> {
    // 작가의 defaultThemeId로 기본 테마 조회
    const author = await this.prisma.author.findUnique({
      where: { slug },
      select: { defaultThemeId: true },
    })
    if (author?.defaultThemeId) {
      const theme = await this.prisma.theme.findUnique({ where: { id: author.defaultThemeId } })
      // defaultThemeId가 슬롯에 있는 경우만 반환
      if (theme?.isSlotted) return toDomain(theme)
    }
    // defaultThemeId 없거나 비슬롯 → 슬롯된 첫 번째 테마 반환
    const firstSlotted = await this.prisma.theme.findFirst({
      where: { author: { slug }, isSlotted: true },
      orderBy: { updatedAt: 'desc' },
    })
    return firstSlotted ? toDomain(firstSlotted) : null
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
    source: string = 'user',
  ): Promise<Theme> {
    const row = await this.prisma.theme.create({
      data: {
        authorId,
        name,
        preset,
        overrides: overrides as object,
        rawDescription,
        source,
      },
    })
    return toDomain(row)
  }

  async update(
    themeId: string,
    preset: string,
    overrides: AuthorTheme,
    rawDescription: string,
    source?: string,
    name?: string,
  ): Promise<Theme> {
    const row = await this.prisma.theme.update({
      where: { id: themeId },
      data: {
        preset,
        overrides: overrides as object,
        rawDescription,
        ...(source && { source }),
        ...(name && { name }),
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
    // defaultThemeId 고아 참조 정리
    await this.prisma.author.updateMany({
      where: { defaultThemeId: themeId },
      data: { defaultThemeId: null },
    })
    await this.prisma.theme.delete({ where: { id: themeId } })
  }

  async updateBakedCssUrl(themeId: string, url: string | null): Promise<void> {
    await this.prisma.theme.update({
      where: { id: themeId },
      data: { bakedCssUrl: url },
    })
  }

  async countSlottedByAuthorId(authorId: string): Promise<number> {
    return this.prisma.theme.count({ where: { authorId, isSlotted: true } })
  }

  async updateSlotStatus(themeId: string, isSlotted: boolean): Promise<Theme> {
    const row = await this.prisma.theme.update({
      where: { id: themeId },
      data: { isSlotted },
    })
    return toDomain(row)
  }

  async findSlottedByAuthorId(authorId: string): Promise<Theme[]> {
    const rows = await this.prisma.theme.findMany({
      where: { authorId, isSlotted: true },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toDomain)
  }

  async unslotAllByAuthorId(authorId: string): Promise<void> {
    await this.prisma.theme.updateMany({
      where: { authorId },
      data: { isSlotted: false },
    })
  }

  async findSystemThemes(): Promise<Theme[]> {
    const rows = await this.prisma.theme.findMany({
      where: { authorId: { equals: null }, source: 'system' },
      orderBy: { name: 'asc' },
    })
    return rows.map(toDomain)
  }

  async countByAuthorIdSince(authorId: string, sources: string[], since: Date): Promise<number> {
    return this.prisma.theme.count({
      where: { authorId, source: { in: sources }, updatedAt: { gte: since } },
    })
  }

  async findSystemThemeByPreset(preset: string): Promise<Theme | null> {
    const row = await this.prisma.theme.findFirst({
      where: { authorId: { equals: null }, source: 'system', preset },
    })
    return row ? toDomain(row) : null
  }
}

function toDomain(row: {
  id: string
  authorId: string | null
  name: string
  preset: string
  overrides: unknown
  rawDescription: string | null
  bakedCssUrl: string | null
  isSlotted: boolean
  source: string
  createdAt: Date
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
    isSlotted: row.isSlotted,
    source: row.source as 'system' | 'ai' | 'user',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
