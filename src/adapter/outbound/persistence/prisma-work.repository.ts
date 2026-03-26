import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { Work, Episode, EpisodeSummary } from '@domain/model/work'
import { Block } from '@domain/model/block'

@Injectable()
export class PrismaWorkRepository implements WorkRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByAuthorSlug(authorSlug: string): Promise<Work[]> {
    const author = await this.prisma.author.findUnique({ where: { slug: authorSlug } })
    if (!author) return []
    const rows = await this.prisma.work.findMany({
      where: { authorId: author.id },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toWorkDomain)
  }

  async findByAuthorAndWorkSlug(authorSlug: string, workSlug: string): Promise<Work | null> {
    const author = await this.prisma.author.findUnique({ where: { slug: authorSlug } })
    if (!author) return null
    const row = await this.prisma.work.findUnique({
      where: { authorId_slug: { authorId: author.id, slug: workSlug } },
    })
    return row ? toWorkDomain(row) : null
  }

  async findEpisodes(workId: string): Promise<EpisodeSummary[]> {
    const rows = await this.prisma.episode.findMany({
      where: { workId },
      orderBy: { orderNum: 'asc' },
      select: { id: true, slug: true, title: true, subtitle: true, orderNum: true },
    })
    return rows
  }

  async findEpisode(authorSlug: string, workSlug: string, episodeSlug: string): Promise<Episode | null> {
    const author = await this.prisma.author.findUnique({ where: { slug: authorSlug } })
    if (!author) return null
    const work = await this.prisma.work.findUnique({
      where: { authorId_slug: { authorId: author.id, slug: workSlug } },
    })
    if (!work) return null
    const row = await this.prisma.episode.findUnique({
      where: { workId_slug: { workId: work.id, slug: episodeSlug } },
    })
    return row ? toEpisodeDomain(row) : null
  }

  async createWork(input: {
    authorId: string
    slug: string
    title: string
    subtitle?: string
    description?: string
  }): Promise<Work> {
    const row = await this.prisma.work.create({ data: input })
    return toWorkDomain(row)
  }

  async createEpisode(input: {
    workId: string
    slug: string
    title: string
    subtitle?: string
    orderNum: number
    blocks: Block[]
    rawMd: string
  }): Promise<Episode> {
    const row = await this.prisma.episode.create({
      data: {
        workId: input.workId,
        slug: input.slug,
        title: input.title,
        subtitle: input.subtitle,
        orderNum: input.orderNum,
        blocks: input.blocks as object[],
        rawMd: input.rawMd,
      },
    })
    return toEpisodeDomain(row)
  }

  async countByAuthorId(authorId: string): Promise<number> {
    return this.prisma.work.count({ where: { authorId } })
  }
}

function toWorkDomain(row: {
  id: string; authorId: string; slug: string; title: string;
  subtitle: string | null; description: string | null; createdAt: Date
}): Work {
  return { id: row.id, authorId: row.authorId, slug: row.slug, title: row.title, subtitle: row.subtitle, description: row.description, createdAt: row.createdAt }
}

function toEpisodeDomain(row: {
  id: string; workId: string; slug: string; title: string;
  subtitle: string | null; orderNum: number; blocks: unknown; rawMd: string; createdAt: Date
}): Episode {
  return { id: row.id, workId: row.workId, slug: row.slug, title: row.title, subtitle: row.subtitle, orderNum: row.orderNum, blocks: row.blocks as Block[], rawMd: row.rawMd, createdAt: row.createdAt }
}
