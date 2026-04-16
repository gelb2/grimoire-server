import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { Work, Episode, EpisodeSummary, WorkWithMeta, EpisodeStatus } from '@domain/model/work'
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

  async findById(id: string): Promise<Work | null> {
    const row = await this.prisma.work.findUnique({ where: { id } })
    return row ? toWorkDomain(row) : null
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
      select: { id: true, slug: true, title: true, subtitle: true, description: true, type: true, orderNum: true, status: true },
    })
    return rows.map((r) => ({ ...r, status: r.status as EpisodeStatus }))
  }

  async findEpisodeById(id: string): Promise<Episode | null> {
    const row = await this.prisma.episode.findUnique({ where: { id } })
    return row ? toEpisodeDomain(row) : null
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

  async updateWork(id: string, input: { title?: string; subtitle?: string; description?: string; coverImage?: string | null }): Promise<Work> {
    const row = await this.prisma.work.update({ where: { id }, data: input })
    return toWorkDomain(row)
  }

  async deleteWork(id: string): Promise<void> {
    // 에피소드 먼저 삭제 (cascade)
    await this.prisma.episode.deleteMany({ where: { workId: id } })
    await this.prisma.work.delete({ where: { id } })
  }

  async createEpisode(input: {
    workId: string
    slug: string
    title: string
    subtitle?: string
    description?: string
    type?: string
    orderNum: number
    blocks: Block[]
    rawMd: string
    sourceFormat?: string
  }): Promise<Episode> {
    const row = await this.prisma.episode.create({
      data: {
        workId: input.workId,
        slug: input.slug,
        title: input.title,
        subtitle: input.subtitle,
        description: input.description,
        type: input.type || 'episode',
        orderNum: input.orderNum,
        blocks: input.blocks as object[],
        rawMd: input.rawMd,
        sourceFormat: input.sourceFormat || 'markdown',
      },
    })
    return toEpisodeDomain(row)
  }

  async deleteEpisode(id: string): Promise<void> {
    await this.prisma.episode.delete({ where: { id } })
  }

  async updateEpisodeIndexed(id: string, isIndexed: boolean): Promise<void> {
    await this.prisma.episode.update({ where: { id }, data: { isIndexed } })
  }

  async updateEpisodeContent(id: string, data: { title?: string; subtitle?: string; description?: string; blocks?: any; rawMd?: string; sourceFormat?: string }): Promise<Episode> {
    const row = await this.prisma.episode.update({ where: { id }, data })
    return toEpisodeDomain(row)
  }

  async updateWorkThemeId(workId: string, themeId: string | null): Promise<Work> {
    const row = await this.prisma.work.update({
      where: { id: workId },
      data: { themeId },
    })
    return toWorkDomain(row)
  }

  async countByAuthorId(authorId: string): Promise<number> {
    return this.prisma.work.count({ where: { authorId } })
  }

  async countEpisodesByWorkId(workId: string): Promise<number> {
    return this.prisma.episode.count({ where: { workId } })
  }

  async searchByTitle(query: string, limit: number): Promise<Work[]> {
    const rows = await this.prisma.work.findMany({
      where: { title: { contains: query, mode: 'insensitive' } },
      take: limit,
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toWorkDomain)
  }

  async findPopular(limit: number): Promise<WorkWithMeta[]> {
    const rows = await this.prisma.work.findMany({
      take: limit,
      orderBy: [{ viewCount: 'desc' }, { createdAt: 'asc' }],
      include: {
        author: { select: { name: true, slug: true } },
        _count: { select: { episodes: true } },
      },
    })
    return rows.map((r) => ({
      ...toWorkDomain(r),
      authorName: r.author.name,
      authorSlug: r.author.slug,
      episodeCount: r._count.episodes,
    }))
  }

  async findRecent(limit: number): Promise<WorkWithMeta[]> {
    const rows = await this.prisma.work.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { name: true, slug: true } },
        _count: { select: { episodes: true } },
      },
    })
    return rows.map((r) => ({
      ...toWorkDomain(r),
      authorName: r.author.name,
      authorSlug: r.author.slug,
      episodeCount: r._count.episodes,
    }))
  }

  async findPopularPaginated(page: number, pageSize: number): Promise<{ works: WorkWithMeta[]; totalCount: number }> {
    const [rows, totalCount] = await Promise.all([
      this.prisma.work.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ viewCount: 'desc' }, { createdAt: 'asc' }],
        include: {
          author: { select: { name: true, slug: true } },
          _count: { select: { episodes: true } },
        },
      }),
      this.prisma.work.count(),
    ])
    return {
      works: rows.map((r) => ({
        ...toWorkDomain(r),
        authorName: r.author.name,
        authorSlug: r.author.slug,
        episodeCount: r._count.episodes,
      })),
      totalCount,
    }
  }

  async findRecentPaginated(page: number, pageSize: number): Promise<{ works: WorkWithMeta[]; totalCount: number }> {
    const [rows, totalCount] = await Promise.all([
      this.prisma.work.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          author: { select: { name: true, slug: true } },
          _count: { select: { episodes: true } },
        },
      }),
      this.prisma.work.count(),
    ])
    return {
      works: rows.map((r) => ({
        ...toWorkDomain(r),
        authorName: r.author.name,
        authorSlug: r.author.slug,
        episodeCount: r._count.episodes,
      })),
      totalCount,
    }
  }

  async countAll(): Promise<number> {
    return this.prisma.work.count()
  }

  async countAllEpisodes(): Promise<number> {
    return this.prisma.episode.count()
  }

  async updateEpisodeStatus(id: string, status: EpisodeStatus, sharedToken?: string | null, sharedExpireAt?: Date | null): Promise<Episode> {
    const row = await this.prisma.episode.update({
      where: { id },
      data: {
        status,
        sharedToken: sharedToken !== undefined ? sharedToken : undefined,
        sharedExpireAt: sharedExpireAt !== undefined ? sharedExpireAt : undefined,
      },
    })
    return toEpisodeDomain(row)
  }

  async findBySharedToken(token: string): Promise<Episode | null> {
    const row = await this.prisma.episode.findUnique({ where: { sharedToken: token } })
    return row ? toEpisodeDomain(row) : null
  }

  async findEpisodesFiltered(workId: string, excludeStatuses?: EpisodeStatus[]): Promise<EpisodeSummary[]> {
    const rows = await this.prisma.episode.findMany({
      where: {
        workId,
        ...(excludeStatuses?.length ? { status: { notIn: excludeStatuses } } : {}),
      },
      orderBy: { orderNum: 'asc' },
      select: { id: true, slug: true, title: true, subtitle: true, description: true, type: true, orderNum: true, status: true },
    })
    return rows.map((r) => ({ ...r, status: r.status as EpisodeStatus }))
  }
}

function toWorkDomain(row: {
  id: string; authorId: string; slug: string; title: string;
  subtitle: string | null; description: string | null; coverImage?: string | null; context?: string | null; instructions?: string | null; themeId?: string | null; viewCount?: number; createdAt: Date
}): Work {
  return { id: row.id, authorId: row.authorId, slug: row.slug, title: row.title, subtitle: row.subtitle, description: row.description, coverImage: row.coverImage ?? null, context: row.context ?? null, instructions: row.instructions ?? null, themeId: row.themeId ?? null, viewCount: row.viewCount ?? 0, createdAt: row.createdAt }
}

function toEpisodeDomain(row: {
  id: string; workId: string; slug: string; title: string;
  subtitle: string | null; description: string | null; type: string; orderNum: number; blocks: unknown; rawMd: string;
  viewCount: number; sourceFormat: string; isIndexed: boolean;
  status: string; sharedToken: string | null; sharedExpireAt: Date | null; createdAt: Date
}): Episode {
  return { id: row.id, workId: row.workId, slug: row.slug, title: row.title, subtitle: row.subtitle, description: row.description, type: row.type, orderNum: row.orderNum, blocks: row.blocks as Block[], rawMd: row.rawMd, viewCount: row.viewCount, sourceFormat: row.sourceFormat, isIndexed: row.isIndexed, status: row.status as EpisodeStatus, sharedToken: row.sharedToken, sharedExpireAt: row.sharedExpireAt, createdAt: row.createdAt }
}
