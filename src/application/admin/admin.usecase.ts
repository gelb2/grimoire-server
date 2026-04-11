import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { AuditLogService } from './audit-log.service'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { CreditLog } from '@domain/model/credit'
import { Author } from '@domain/model/author'
import { EpisodeStatus } from '@domain/model/work'

@Injectable()
export class AdminUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('CreditRepositoryPort') private readonly creditRepo: CreditRepositoryPort,
    private readonly creditUseCase: CreditUseCase,
    private readonly auditLog: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── 통계 (강화) ───

  async getStats() {
    const [totalAuthors, totalWorks, totalEpisodes, totalCreditsConsumed, totalComments, totalPaymentsCompleted] = await Promise.all([
      this.authorRepo.count(),
      this.workRepo.countAll(),
      this.workRepo.countAllEpisodes(),
      this.creditRepo.sumNegativeAmounts(),
      this.prisma.comment.count(),
      this.prisma.payment.count({ where: { status: 'completed' } }),
    ])
    return {
      totalAuthors,
      totalWorks,
      totalEpisodes,
      totalCreditsConsumed: Math.abs(totalCreditsConsumed),
      totalComments,
      totalPaymentsCompleted,
    }
  }

  // ─── 사용자 관리 ───

  async listAuthors(options: { page?: number; limit?: number; query?: string }) {
    return this.authorRepo.findAll({
      page: options.page ?? 1,
      limit: options.limit ?? 20,
      query: options.query,
    })
  }

  async getAuthor(authorId: string): Promise<Author> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    return author
  }

  async createAuthor(
    adminId: string,
    input: { email: string; name: string; slug: string; password: string; plan?: string },
  ): Promise<Author> {
    const existingEmail = await this.authorRepo.findByEmail(input.email)
    if (existingEmail) throw new BadRequestException('이미 가입된 이메일입니다')

    const existingSlug = await this.authorRepo.findBySlug(input.slug)
    if (existingSlug) throw new BadRequestException('이미 사용 중인 슬러그입니다')

    const passwordHash = await bcrypt.hash(input.password, 10)
    const author = await this.authorRepo.create({
      slug: input.slug, name: input.name, email: input.email, passwordHash,
    })

    if (input.plan && input.plan !== 'free') {
      await this.authorRepo.updatePlan(author.id, input.plan, null)
    }

    await this.auditLog.log(adminId, 'author_create', author.id, {
      slug: input.slug, email: input.email, plan: input.plan ?? 'free',
    })
    return author
  }

  async updateAuthor(adminId: string, authorId: string, data: { name?: string; bio?: string }): Promise<Author> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    const updated = await this.authorRepo.updateProfile(authorId, data)
    await this.auditLog.log(adminId, 'author_update', authorId, { before: { name: author.name, bio: author.bio }, after: data })
    return updated
  }

  async deleteAuthor(adminId: string, authorId: string): Promise<void> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    if (author.role === 'admin') throw new BadRequestException('관리자 계정은 삭제할 수 없습니다')
    await this.authorRepo.deleteById(authorId)
    await this.auditLog.log(adminId, 'author_delete', authorId, { slug: author.slug, email: author.email, name: author.name })
  }

  async changeRole(adminId: string, authorId: string, role: string): Promise<Author> {
    if (!['user', 'admin'].includes(role)) throw new BadRequestException('유효한 역할: user, admin')
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    const updated = await this.authorRepo.updateRole(authorId, role)
    await this.auditLog.log(adminId, 'role_change', authorId, { before: author.role, after: role })
    return updated
  }

  // ─── 크레딧 관리 ───

  async grantCredits(adminId: string, authorId: string, amount: number, reason: string): Promise<{ credits: number; log: CreditLog }> {
    const result = await this.creditUseCase.grant(authorId, amount, `admin_grant:${reason}`)
    await this.auditLog.log(adminId, 'credit_grant', authorId, { amount, reason })
    return result
  }

  async deductCredits(adminId: string, authorId: string, amount: number, reason: string): Promise<{ credits: number; log: CreditLog }> {
    const result = await this.creditUseCase.deduct(authorId, amount, `admin_deduct:${reason}`)
    await this.auditLog.log(adminId, 'credit_deduct', authorId, { amount, reason })
    return result
  }

  async getAllCreditLogs(authorId?: string) {
    if (authorId) return this.creditRepo.findLogsByAuthorId(authorId)
    return []
  }

  // ─── 플랜 관리 ───

  async changePlan(adminId: string, authorId: string, plan: string, durationDays: number): Promise<void> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    const planExpireAt = durationDays > 0 ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000) : null
    await this.authorRepo.updatePlan(authorId, plan, planExpireAt)
    await this.auditLog.log(adminId, 'plan_change', authorId, {
      before: { plan: author.plan, planExpireAt: author.planExpireAt },
      after: { plan, durationDays },
    })
  }

  // ─── 콘텐츠 관리 (신규) ───

  async listWorks(options: { page?: number; limit?: number; query?: string; authorId?: string }) {
    const page = options.page ?? 1
    const limit = options.limit ?? 20
    const where: any = {}
    if (options.query) where.title = { contains: options.query, mode: 'insensitive' }
    if (options.authorId) where.authorId = options.authorId

    const [items, total] = await Promise.all([
      this.prisma.work.findMany({
        where,
        include: { author: { select: { name: true, slug: true } }, _count: { select: { episodes: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.work.count({ where }),
    ])

    return {
      items: items.map(w => ({
        id: w.id, slug: w.slug, title: w.title, subtitle: w.subtitle,
        authorName: w.author.name, authorSlug: w.author.slug,
        episodeCount: w._count.episodes, viewCount: w.viewCount,
        createdAt: w.createdAt,
      })),
      total,
    }
  }

  async getWorkDetail(workId: string) {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      include: {
        author: { select: { name: true, slug: true } },
        episodes: { orderBy: { orderNum: 'asc' }, select: { id: true, slug: true, title: true, status: true, viewCount: true, orderNum: true, createdAt: true } },
      },
    })
    if (!work) throw new NotFoundException('작품을 찾을 수 없습니다')
    return work
  }

  async getEpisodeDetail(episodeId: string) {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } })
    if (!episode) throw new NotFoundException('에피소드를 찾을 수 없습니다')
    return episode
  }

  async changeEpisodeStatus(adminId: string, episodeId: string, status: EpisodeStatus) {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } })
    if (!episode) throw new NotFoundException('에피소드를 찾을 수 없습니다')

    await this.prisma.episode.update({ where: { id: episodeId }, data: { status } })
    await this.auditLog.log(adminId, 'episode_status_change', episodeId, { before: episode.status, after: status })
    return { success: true }
  }

  // ─── 댓글 관리 (신규) ───

  async listComments(options: { page?: number; limit?: number; episodeId?: string; query?: string }) {
    const page = options.page ?? 1
    const limit = options.limit ?? 20
    const where: any = {}
    if (options.episodeId) where.episodeId = options.episodeId
    if (options.query) where.content = { contains: options.query, mode: 'insensitive' }

    const [items, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.comment.count({ where }),
    ])
    return { items, total }
  }

  async deleteComment(adminId: string, commentId: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } })
    if (!comment) throw new NotFoundException('댓글을 찾을 수 없습니다')

    await this.prisma.comment.delete({ where: { id: commentId } })
    await this.auditLog.log(adminId, 'comment_delete_admin', commentId, {
      episodeId: comment.episodeId, content: comment.content?.slice(0, 100),
    })
    return { deleted: true }
  }

  // ─── 결제 내역 (신규 — 기존 빈 구현 교체) ───

  async listPayments(options: { page?: number; limit?: number; authorId?: string; status?: string }) {
    const page = options.page ?? 1
    const limit = options.limit ?? 20
    const where: any = {}
    if (options.authorId) where.authorId = options.authorId
    if (options.status) where.status = options.status

    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ])
    return { items, total }
  }

  // ─── 접근 로그 (신규) ───

  async listAccessLogs(options: { page?: number; limit?: number; action?: string; ip?: string; authorId?: string }) {
    const page = options.page ?? 1
    const limit = options.limit ?? 50
    const where: any = {}
    if (options.action) where.action = options.action
    if (options.ip) where.ip = options.ip
    if (options.authorId) where.authorId = options.authorId

    const [items, total] = await Promise.all([
      this.prisma.accessLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.accessLog.count({ where }),
    ])
    return { items, total }
  }

  // ─── 사용자 제재 ───

  async sanctionUser(adminId: string, authorId: string, type: string, reason: string, detail?: string) {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    if (author.role === 'admin') throw new BadRequestException('관리자는 제재할 수 없습니다')

    const durationMap: Record<string, number> = {
      suspend_1d: 1, suspend_7d: 7, suspend_30d: 30,
    }
    const days = durationMap[type]
    const endAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : (type === 'permanent' ? null : null)

    const sanction = await this.prisma.userSanction.create({
      data: { authorId, type, reason, detail, adminId, endAt, isActive: true },
    })

    await this.auditLog.log(adminId, 'user_sanction', authorId, { type, reason, detail })
    return sanction
  }

  async liftSanction(adminId: string, sanctionId: string) {
    const sanction = await this.prisma.userSanction.findUnique({ where: { id: sanctionId } })
    if (!sanction) throw new NotFoundException('제재 기록을 찾을 수 없습니다')

    await this.prisma.userSanction.update({ where: { id: sanctionId }, data: { isActive: false } })
    await this.auditLog.log(adminId, 'user_sanction_lift', sanction.authorId, { sanctionId, type: sanction.type })
    return { lifted: true }
  }

  async listSanctions(authorId?: string) {
    const where: any = {}
    if (authorId) where.authorId = authorId
    return this.prisma.userSanction.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
  }

  /** 로그인 시 활성 제재 확인 */
  async getActiveSanction(authorId: string) {
    // 만료된 제재 자동 비활성화
    await this.prisma.userSanction.updateMany({
      where: { authorId, isActive: true, endAt: { not: null, lt: new Date() } },
      data: { isActive: false },
    })
    return this.prisma.userSanction.findFirst({
      where: { authorId, isActive: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  // ─── 콘텐츠 신고 ───

  async listReports(options: { page?: number; limit?: number; status?: string }) {
    const page = options.page ?? 1
    const limit = options.limit ?? 20
    const where: any = {}
    if (options.status) where.status = options.status

    const [items, total] = await Promise.all([
      this.prisma.report.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.report.count({ where }),
    ])
    return { items, total }
  }

  async resolveReport(adminId: string, reportId: string, action: 'approved' | 'rejected') {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } })
    if (!report) throw new NotFoundException('신고를 찾을 수 없습니다')

    await this.prisma.report.update({
      where: { id: reportId },
      data: { status: action, resolvedBy: adminId, resolvedAt: new Date() },
    })

    // 승인 시 대상 콘텐츠 비공개 처리
    if (action === 'approved') {
      if (report.targetType === 'episode') {
        await this.prisma.episode.update({ where: { id: report.targetId }, data: { status: 'nonPublic' } }).catch(() => {})
      } else if (report.targetType === 'comment') {
        await this.prisma.comment.delete({ where: { id: report.targetId } }).catch(() => {})
      }
    }

    await this.auditLog.log(adminId, 'report_resolve', reportId, { action, targetType: report.targetType, targetId: report.targetId })
    return { resolved: true }
  }

  // ─── 시스템 설정 ───

  async getSettings() {
    const rows = await this.prisma.systemSetting.findMany()
    const settings: Record<string, string> = {}
    for (const r of rows) settings[r.key] = r.value
    return settings
  }

  async updateSetting(adminId: string, key: string, value: string) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value, updatedBy: adminId },
      update: { value, updatedBy: adminId },
    })
    await this.auditLog.log(adminId, 'setting_change', key, { value })
    return { key, value }
  }

  // ─── 감사 로그 ───

  async getAuditLogs(options: { page?: number; limit?: number; action?: string }) {
    return this.auditLog.findAll(options)
  }
}
