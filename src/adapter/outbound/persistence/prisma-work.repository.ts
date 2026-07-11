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

  async updateWork(id: string, input: { title?: string; subtitle?: string; description?: string; coverImage?: string | null; context?: string | null; instructions?: string | null }): Promise<Work> {
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
      // F-8 — soft-delete 작가 제외 (soft-delete extension 은 top-level author op 만 필터,
      // work 직접 조회는 미적용 → 관계 필터 명시). deleted 작가 작품이 검색에 노출되면 404 dead link.
      where: { title: { contains: query, mode: 'insensitive' }, author: { is: { deletedAt: null } } },
      take: limit,
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toWorkDomain)
  }

  /**
   * 인기 가중 랭킹 — engagement 반영
   * score = viewCount + likes*10 + comments*5 + authorSubscribers*30
   * (작품 규모가 작아 전체 로드 후 메모리 정렬. 작품 수 증가 시 쿼리 최적화 필요)
   */
  private async computeRankedWorks(): Promise<(WorkWithMeta & { score: number; lastEpisodeAt: Date | null })[]> {
    const [works, likeAgg, commentAgg, subsAgg] = await Promise.all([
      this.prisma.work.findMany({
        // F-8 — discovery(popular/recent) 에서 soft-delete 작가 작품 제외 (dead link 방지).
        // soft-delete extension 은 nested include: { author } 에 미적용 → 관계 필터 명시 필수.
        where: { author: { is: { deletedAt: null } } },
        include: {
          author: { select: { name: true, slug: true } },
          _count: { select: { episodes: true } },
          episodes: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
        },
      }),
      this.prisma.$queryRaw<{ workId: string; n: bigint }[]>`
        SELECT e.work_id AS "workId", COUNT(l.id) AS n
        FROM episodes e
        LEFT JOIN likes l ON l.episode_id = e.id
        GROUP BY e.work_id
      `,
      this.prisma.$queryRaw<{ workId: string; n: bigint }[]>`
        SELECT e.work_id AS "workId", COUNT(c.id) AS n
        FROM episodes e
        LEFT JOIN comments c ON c.episode_id = e.id
        GROUP BY e.work_id
      `,
      this.prisma.subscription.groupBy({ by: ['targetAuthorId'], _count: { _all: true } }),
    ])

    const likesMap = new Map(likeAgg.map((r) => [r.workId, Number(r.n)]))
    const commentsMap = new Map(commentAgg.map((r) => [r.workId, Number(r.n)]))
    const subsMap = new Map(subsAgg.map((r) => [r.targetAuthorId, r._count._all]))

    return works.map((w) => {
      const likes = likesMap.get(w.id) ?? 0
      const comments = commentsMap.get(w.id) ?? 0
      const subs = subsMap.get(w.authorId) ?? 0
      const score = w.viewCount + likes * 10 + comments * 5 + subs * 30
      return {
        ...toWorkDomain(w),
        authorName: w.author.name,
        authorSlug: w.author.slug,
        episodeCount: w._count.episodes,
        score,
        lastEpisodeAt: w.episodes[0]?.createdAt ?? null,
      }
    })
  }

  async findPopular(limit: number): Promise<WorkWithMeta[]> {
    const ranked = await this.computeRankedWorks()
    ranked.sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime())
    return ranked.slice(0, limit).map(({ score: _s, lastEpisodeAt: _l, ...rest }) => rest)
  }

  async findRecent(limit: number): Promise<WorkWithMeta[]> {
    // "최신"은 최근 에피소드 업데이트 기준 — 활발한 연재작이 먼저 노출되도록.
    // 에피소드가 아직 없는 작품은 작품 생성일로 폴백.
    const ranked = await this.computeRankedWorks()
    ranked.sort((a, b) => {
      const at = a.lastEpisodeAt?.getTime() ?? a.createdAt.getTime()
      const bt = b.lastEpisodeAt?.getTime() ?? b.createdAt.getTime()
      return bt - at
    })
    return ranked.slice(0, limit).map(({ score: _s, lastEpisodeAt: _l, ...rest }) => rest)
  }

  async findPopularPaginated(page: number, pageSize: number): Promise<{ works: WorkWithMeta[]; totalCount: number }> {
    const ranked = await this.computeRankedWorks()
    ranked.sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime())
    const start = (page - 1) * pageSize
    return {
      works: ranked.slice(start, start + pageSize).map(({ score: _s, lastEpisodeAt: _l, ...rest }) => rest),
      totalCount: ranked.length,
    }
  }

  async findRecentPaginated(page: number, pageSize: number): Promise<{ works: WorkWithMeta[]; totalCount: number }> {
    // "최신"도 computeRankedWorks로 일관된 경로. 에피소드 최근 업데이트 기준 정렬.
    const ranked = await this.computeRankedWorks()
    ranked.sort((a, b) => {
      const at = a.lastEpisodeAt?.getTime() ?? a.createdAt.getTime()
      const bt = b.lastEpisodeAt?.getTime() ?? b.createdAt.getTime()
      return bt - at
    })
    const start = (page - 1) * pageSize
    return {
      works: ranked.slice(start, start + pageSize).map(({ score: _s, lastEpisodeAt: _l, ...rest }) => rest),
      totalCount: ranked.length,
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
    // F-8 — soft-delete 작가의 shared 에피소드 토큰 접근 차단. sharedToken 은 @unique 라
    // findFirst(관계 필터 허용)로 조회 — findUnique 는 unique 필드 외 where 를 못 받는다.
    const row = await this.prisma.episode.findFirst({
      where: { sharedToken: token, work: { author: { is: { deletedAt: null } } } },
    })
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
