import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { AdminRepositoryPort } from '@domain/port/outbound/admin-repository.port'
import { EpisodeStatus } from '@domain/model/work'

@Injectable()
export class PrismaAdminRepository implements AdminRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async countComments() { return this.prisma.comment.count() }
  async countCompletedPayments() { return this.prisma.payment.count({ where: { status: 'completed' } }) }

  async listWorks(options: { page: number; limit: number; query?: string; authorId?: string }) {
    const where: any = {}
    if (options.query) where.title = { contains: options.query, mode: 'insensitive' }
    if (options.authorId) where.authorId = options.authorId
    const [items, total] = await Promise.all([
      this.prisma.work.findMany({
        where, include: { author: { select: { name: true, slug: true } }, _count: { select: { episodes: true } } },
        orderBy: { createdAt: 'desc' }, skip: (options.page - 1) * options.limit, take: options.limit,
      }),
      this.prisma.work.count({ where }),
    ])
    return {
      items: items.map(w => ({
        id: w.id, slug: w.slug, title: w.title, subtitle: w.subtitle,
        authorName: w.author.name, authorSlug: w.author.slug,
        episodeCount: w._count.episodes, viewCount: w.viewCount, createdAt: w.createdAt,
      })),
      total,
    }
  }

  async getWorkDetail(workId: string) {
    return this.prisma.work.findUnique({
      where: { id: workId },
      include: {
        author: { select: { name: true, slug: true } },
        episodes: { orderBy: { orderNum: 'asc' }, select: { id: true, slug: true, title: true, status: true, viewCount: true, orderNum: true, createdAt: true } },
      },
    })
  }

  async getEpisodeDetail(episodeId: string) { return this.prisma.episode.findUnique({ where: { id: episodeId } }) }
  async changeEpisodeStatus(episodeId: string, status: EpisodeStatus) { await this.prisma.episode.update({ where: { id: episodeId }, data: { status } }) }

  async listComments(options: { page: number; limit: number; episodeId?: string; query?: string }) {
    const where: any = {}
    if (options.episodeId) where.episodeId = options.episodeId
    if (options.query) where.content = { contains: options.query, mode: 'insensitive' }
    const [items, total] = await Promise.all([
      this.prisma.comment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (options.page - 1) * options.limit, take: options.limit }),
      this.prisma.comment.count({ where }),
    ])
    return { items, total }
  }

  async findComment(commentId: string) { return this.prisma.comment.findUnique({ where: { id: commentId } }) }
  async deleteComment(commentId: string) { await this.prisma.comment.delete({ where: { id: commentId } }) }

  async listPayments(options: { page: number; limit: number; authorId?: string; status?: string }) {
    const where: any = {}
    if (options.authorId) where.authorId = options.authorId
    if (options.status) where.status = options.status
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (options.page - 1) * options.limit, take: options.limit }),
      this.prisma.payment.count({ where }),
    ])
    return { items, total }
  }

  async getRevenueSummary() {
    const [totalRevenue, monthlyRevenue, productBreakdown] = await Promise.all([
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'completed' } }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'completed', createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
      }),
      this.prisma.payment.groupBy({ by: ['productId'], _sum: { amount: true }, _count: true, where: { status: 'completed' } }),
    ])
    return {
      totalRevenue: totalRevenue._sum.amount ?? 0,
      monthlyRevenue: monthlyRevenue._sum.amount ?? 0,
      products: productBreakdown.map(p => ({ productId: p.productId, total: p._sum.amount ?? 0, count: p._count })),
    }
  }

  async listAccessLogs(options: { page: number; limit: number; action?: string; ip?: string; authorId?: string }) {
    const where: any = {}
    if (options.action) where.action = options.action
    if (options.ip) where.ip = options.ip
    if (options.authorId) where.authorId = options.authorId
    const [items, total] = await Promise.all([
      this.prisma.accessLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (options.page - 1) * options.limit, take: options.limit }),
      this.prisma.accessLog.count({ where }),
    ])
    return { items, total }
  }

  async createSanction(data: { authorId: string; type: string; reason: string; detail?: string; adminId: string; endAt: Date | null }) {
    return this.prisma.userSanction.create({ data: { ...data, isActive: true } })
  }

  async findSanction(sanctionId: string) { return this.prisma.userSanction.findUnique({ where: { id: sanctionId } }) }
  async liftSanction(sanctionId: string) { await this.prisma.userSanction.update({ where: { id: sanctionId }, data: { isActive: false } }) }

  async listSanctions(authorId?: string) {
    const where: any = {}
    if (authorId) where.authorId = authorId
    return this.prisma.userSanction.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
  }

  async expireAndFindActiveSanction(authorId: string) {
    await this.prisma.userSanction.updateMany({
      where: { authorId, isActive: true, endAt: { not: null, lt: new Date() } },
      data: { isActive: false },
    })
    return this.prisma.userSanction.findFirst({ where: { authorId, isActive: true }, orderBy: { createdAt: 'desc' } })
  }

  async listReports(options: { page: number; limit: number; status?: string }) {
    const where: any = {}
    if (options.status) where.status = options.status
    const [items, total] = await Promise.all([
      this.prisma.report.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (options.page - 1) * options.limit, take: options.limit }),
      this.prisma.report.count({ where }),
    ])
    return { items, total }
  }

  async findReport(reportId: string) { return this.prisma.report.findUnique({ where: { id: reportId } }) }
  async resolveReport(reportId: string, action: string, adminId: string) {
    await this.prisma.report.update({ where: { id: reportId }, data: { status: action, resolvedBy: adminId, resolvedAt: new Date() } })
  }
  async hideEpisode(episodeId: string) { await this.prisma.episode.update({ where: { id: episodeId }, data: { status: 'nonPublic' } }).catch(() => {}) }
  async deleteCommentById(commentId: string) { await this.prisma.comment.delete({ where: { id: commentId } }).catch(() => {}) }

  async getSettings() {
    const rows = await this.prisma.systemSetting.findMany()
    const settings: Record<string, string> = {}
    for (const r of rows) settings[r.key] = r.value
    return settings
  }
  async updateSetting(key: string, value: string, adminId: string) {
    await this.prisma.systemSetting.upsert({ where: { key }, create: { key, value, updatedBy: adminId }, update: { value, updatedBy: adminId } })
  }

  async getTimeseries(metric: string, since: Date) {
    if (metric === 'signups') {
      const rows = await this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT DATE(created_at) as date, COUNT(*)::int as count FROM authors WHERE created_at >= ${since} GROUP BY DATE(created_at) ORDER BY date`
      return rows.map(r => ({ date: String(r.date).split('T')[0], count: Number(r.count) }))
    }
    if (metric === 'views') {
      const rows = await this.prisma.dailyView.groupBy({ by: ['date'], _sum: { count: true }, where: { date: { gte: since } }, orderBy: { date: 'asc' } })
      return rows.map(r => ({ date: r.date.toISOString().split('T')[0], count: r._sum.count ?? 0 }))
    }
    if (metric === 'payments') {
      const rows = await this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT DATE(created_at) as date, COUNT(*)::int as count FROM payments WHERE status = 'completed' AND created_at >= ${since} GROUP BY DATE(created_at) ORDER BY date`
      return rows.map(r => ({ date: String(r.date).split('T')[0], count: Number(r.count) }))
    }
    return []
  }

  async listAnnouncements(page: number, limit: number) {
    const [items, total] = await Promise.all([
      this.prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.announcement.count(),
    ])
    return { items, total }
  }
  async createAnnouncement(adminId: string, data: { title: string; content: string; isPinned?: boolean; target?: string }) {
    return this.prisma.announcement.create({ data: { title: data.title, content: data.content, isPinned: data.isPinned ?? false, target: data.target ?? 'all', adminId } })
  }
  async deleteAnnouncement(id: string) { await this.prisma.announcement.delete({ where: { id } }) }

  async listFeatured(section?: string) {
    return this.prisma.featuredWork.findMany({ where: section ? { section } : {}, orderBy: { position: 'asc' } })
  }
  async addFeatured(adminId: string, data: { workId: string; section?: string; position?: number }) {
    return this.prisma.featuredWork.create({ data: { workId: data.workId, section: data.section ?? 'main', position: data.position ?? 0, adminId } })
  }
  async removeFeatured(id: string) { await this.prisma.featuredWork.delete({ where: { id } }) }

  async listSystemThemes() { return this.prisma.theme.findMany({ where: { source: 'system', authorId: null }, orderBy: { updatedAt: 'desc' } }) }
  async findSystemTheme(themeId: string) { return this.prisma.theme.findUnique({ where: { id: themeId } }) }
  async createSystemTheme(data: { name: string; preset: string; overrides: any }) {
    return this.prisma.theme.create({ data: { name: data.name, preset: data.preset, overrides: data.overrides, source: 'system', authorId: null } })
  }
  async updateSystemTheme(themeId: string, data: any) { return this.prisma.theme.update({ where: { id: themeId }, data }) }
  async deleteSystemTheme(themeId: string) { await this.prisma.theme.delete({ where: { id: themeId } }) }
}
