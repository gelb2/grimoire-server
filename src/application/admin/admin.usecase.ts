import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditLedgerPort, CreditBalance } from '@domain/port/outbound/credit-ledger.port'
import { CreditSource, isCreditSource } from '@domain/model/credit-source'
import { AdminRepositoryPort } from '@domain/port/outbound/admin-repository.port'
import { GrantPointsUseCase } from '@application/credit/grant-points.usecase'
import { AuditLogService } from './audit-log.service'
import { Author } from '@domain/model/author'
import { EpisodeStatus } from '@domain/model/work'

@Injectable()
export class AdminUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('CreditRepositoryPort') private readonly creditRepo: CreditRepositoryPort,
    @Inject('AdminRepositoryPort') private readonly adminRepo: AdminRepositoryPort,
    // 크레딧 개편 CC-1 (2026-05-19) — 관리자 수동 지급·차감을 신 포인트 원장으로 이행.
    // 지급 = GrantPointsUseCase.grantManual, 차감 = CreditLedgerPort.spend (사전 잔액 검증).
    private readonly grantPoints: GrantPointsUseCase,
    @Inject('CreditLedgerPort') private readonly ledger: CreditLedgerPort,
    private readonly auditLog: AuditLogService,
  ) {}

  // ─── 통계 ───

  async getStats() {
    const [totalAuthors, totalWorks, totalEpisodes, totalCreditsConsumed, totalComments, totalPaymentsCompleted] = await Promise.all([
      this.authorRepo.count(),
      this.workRepo.countAll(),
      this.workRepo.countAllEpisodes(),
      this.creditRepo.sumNegativeAmounts(),
      this.adminRepo.countComments(),
      this.adminRepo.countCompletedPayments(),
    ])
    return {
      totalAuthors, totalWorks, totalEpisodes,
      totalCreditsConsumed: Math.abs(totalCreditsConsumed),
      totalComments, totalPaymentsCompleted,
    }
  }

  // ─── 사용자 관리 ───

  async listAuthors(options: { page?: number; limit?: number; query?: string }) {
    return this.authorRepo.findAll({ page: options.page ?? 1, limit: options.limit ?? 20, query: options.query })
  }

  async getAuthor(authorId: string): Promise<Author> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    return author
  }

  async createAuthor(adminId: string, input: { email: string; name: string; slug: string; password: string; plan?: string }): Promise<Author> {
    const existingEmail = await this.authorRepo.findByEmail(input.email)
    if (existingEmail) throw new BadRequestException('이미 가입된 이메일입니다')
    const existingSlug = await this.authorRepo.findBySlug(input.slug)
    if (existingSlug) throw new BadRequestException('이미 사용 중인 슬러그입니다')
    const passwordHash = await bcrypt.hash(input.password, 10)
    const author = await this.authorRepo.create({ slug: input.slug, name: input.name, email: input.email, passwordHash })
    if (input.plan && input.plan !== 'free') await this.authorRepo.updatePlan(author.id, input.plan, null)
    await this.auditLog.log(adminId, 'author_create', author.id, { slug: input.slug, email: input.email, plan: input.plan ?? 'free' })
    return author
  }

  async updateAuthor(adminId: string, authorId: string, data: { name?: string; bio?: string }): Promise<Author> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    const updated = await this.authorRepo.updateProfile(authorId, data)
    await this.auditLog.log(adminId, 'author_update', authorId, { before: { name: author.name, bio: author.bio }, after: data })
    return updated
  }

  /**
   * 운영자 영역 강제 Author 삭제 영역 영역.
   *
   * USER-SOFT-DELETE sprint (2026-05-15) 정합 — 본 영역 영역 영역 author_delete 호환 영역 영역 영역:
   * - 회귀 영역 영역 (admin.usecase.spec deleteAuthor it 정합 영역 영역) — author_delete audit_log 영역 영역
   * - 본 영역 영역 영역 deprecated → 운영자 강제 삭제 영역 영역 영역 controller 영역 영역 UserSoftDeleteUseCase 영역 영역 영역 영역.
   * - 본 메서드 = legacy + 회귀 호환 영역 영역.
   */
  async deleteAuthor(adminId: string, authorId: string): Promise<void> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    if (author.role === 'admin') throw new BadRequestException('관리자 계정은 삭제할 수 없습니다')
    // USER-SOFT-DELETE 정합 — middleware 영역 영역 자동 변환 영역 (deleteById → soft delete)
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

  /**
   * 운영자 수동 포인트 지급 (T5 — 크레딧 개편 CC-1).
   *
   * 구 CreditUseCase.grant(Author.credits Int) → GrantPointsUseCase.grantManual 교체.
   * source(출처)는 운영자가 명시 — 보통 'charged'(보상성) 또는 'free'(프로모션). 기본 'charged'.
   * AuditLog beforeState/afterState 박제 유지 (PAY-P2-4 정합) — 신 원장 4 출처 합 잔액 기준.
   *
   * @param source 적립 출처 ('free'|'subscription'|'gift'|'charged') — 미지정/유효하지 않으면 'charged'
   */
  async grantCredits(adminId: string, authorId: string, amount: number, reason: string, source?: string): Promise<{ balance: CreditBalance }> {
    // PAY-P2-4 정합 — auditLog beforeState/afterState 박제 (잔액 사전/사후 조회)
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    // 출처 정규화 — 운영자 입력이 유효한 CreditSource 가 아니면 'charged' 폴백
    const resolvedSource: CreditSource = source && isCreditSource(source) ? source : 'charged'
    const beforeState = await this.ledger.getBalance(authorId)

    await this.grantPoints.grantManual(authorId, resolvedSource, amount, adminId)

    const afterState = await this.ledger.getBalance(authorId)
    await this.auditLog.log(
      adminId,
      'credit_grant',
      authorId,
      { amount, reason, source: resolvedSource },
      { points: beforeState.total },
      { points: afterState.total },
    )
    return { balance: afterState }
  }

  /**
   * 운영자 수동 포인트 차감 (T6 — 크레딧 개편 CC-1).
   *
   * 구 CreditUseCase.deduct(Author.credits Int) → CreditLedgerPort.spend 교체.
   * **deficit 불가 모드** — 관리자 차감은 외상 금지. 사전 잔액 검증으로 가용 잔액
   * 부족 시 BadRequestException throw (진단 §1 T6 + MEDIUM-2 "deficit 불가 모드").
   * spend 자체는 deficit 발생 모드이나 사전 검증을 통과하면 정상 시 deficit 미발생.
   */
  async deductCredits(adminId: string, authorId: string, amount: number, reason: string): Promise<{ balance: CreditBalance }> {
    // PAY-P2-4 정합 — auditLog beforeState/afterState 박제. deficit 불가 모드(외상 금지).
    if (amount <= 0) throw new BadRequestException('차감 포인트는 양수여야 합니다')
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    // 가용 잔액 부족 시 차감 거부
    const beforeState = await this.ledger.getBalance(authorId)
    if (beforeState.available < amount) {
      throw new BadRequestException(
        '가용 포인트가 부족합니다. 관리자 차감은 외상이 불가합니다.',
      )
    }

    await this.ledger.spend({
      authorId,
      amount,
      reason: `admin_deduct:${reason}`,
    })

    const afterState = await this.ledger.getBalance(authorId)
    await this.auditLog.log(
      adminId,
      'credit_deduct',
      authorId,
      { amount, reason },
      { points: beforeState.total },
      { points: afterState.total },
    )
    return { balance: afterState }
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
    await this.auditLog.log(adminId, 'plan_change', authorId, { before: { plan: author.plan, planExpireAt: author.planExpireAt }, after: { plan, durationDays } })
  }

  // ─── 콘텐츠 관리 ───

  async listWorks(options: { page?: number; limit?: number; query?: string; authorId?: string }) {
    return this.adminRepo.listWorks({ page: options.page ?? 1, limit: options.limit ?? 20, query: options.query, authorId: options.authorId })
  }

  async getWorkDetail(workId: string) {
    const work = await this.adminRepo.getWorkDetail(workId)
    if (!work) throw new NotFoundException('작품을 찾을 수 없습니다')
    return work
  }

  async getEpisodeDetail(episodeId: string) {
    const episode = await this.adminRepo.getEpisodeDetail(episodeId)
    if (!episode) throw new NotFoundException('에피소드를 찾을 수 없습니다')
    return episode
  }

  async changeEpisodeStatus(adminId: string, episodeId: string, status: EpisodeStatus) {
    const episode = await this.adminRepo.getEpisodeDetail(episodeId)
    if (!episode) throw new NotFoundException('에피소드를 찾을 수 없습니다')
    await this.adminRepo.changeEpisodeStatus(episodeId, status)
    await this.auditLog.log(adminId, 'episode_status_change', episodeId, { before: episode.status, after: status })
    return { success: true }
  }

  // ─── 댓글 관리 ───

  async listComments(options: { page?: number; limit?: number; episodeId?: string; query?: string }) {
    return this.adminRepo.listComments({ page: options.page ?? 1, limit: options.limit ?? 20, episodeId: options.episodeId, query: options.query })
  }

  async deleteComment(adminId: string, commentId: string) {
    const comment = await this.adminRepo.findComment(commentId)
    if (!comment) throw new NotFoundException('댓글을 찾을 수 없습니다')
    await this.adminRepo.deleteComment(commentId)
    await this.auditLog.log(adminId, 'comment_delete_admin', commentId, { episodeId: comment.episodeId, content: comment.content?.slice(0, 100) })
    return { deleted: true }
  }

  // ─── 결제 내역 ───

  async listPayments(options: { page?: number; limit?: number; authorId?: string; status?: string }) {
    return this.adminRepo.listPayments({ page: options.page ?? 1, limit: options.limit ?? 20, authorId: options.authorId, status: options.status })
  }

  // ─── 접근 로그 ───

  async listAccessLogs(options: { page?: number; limit?: number; action?: string; ip?: string; authorId?: string }) {
    return this.adminRepo.listAccessLogs({ page: options.page ?? 1, limit: options.limit ?? 50, action: options.action, ip: options.ip, authorId: options.authorId })
  }

  // ─── 사용자 제재 ───

  async sanctionUser(adminId: string, authorId: string, type: string, reason: string, detail?: string) {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    if (author.role === 'admin') throw new BadRequestException('관리자는 제재할 수 없습니다')
    const durationMap: Record<string, number> = { suspend_1d: 1, suspend_7d: 7, suspend_30d: 30 }
    const days = durationMap[type]
    const endAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null
    const sanction = await this.adminRepo.createSanction({ authorId, type, reason, detail, adminId, endAt })
    await this.auditLog.log(adminId, 'user_sanction', authorId, { type, reason, detail })
    return sanction
  }

  async liftSanction(adminId: string, sanctionId: string) {
    const sanction = await this.adminRepo.findSanction(sanctionId)
    if (!sanction) throw new NotFoundException('제재 기록을 찾을 수 없습니다')
    await this.adminRepo.liftSanction(sanctionId)
    await this.auditLog.log(adminId, 'user_sanction_lift', sanction.authorId, { sanctionId, type: sanction.type })
    return { lifted: true }
  }

  async listSanctions(authorId?: string) { return this.adminRepo.listSanctions(authorId) }
  async getActiveSanction(authorId: string) { return this.adminRepo.expireAndFindActiveSanction(authorId) }

  // ─── 콘텐츠 신고 ───

  async listReports(options: { page?: number; limit?: number; status?: string }) {
    return this.adminRepo.listReports({ page: options.page ?? 1, limit: options.limit ?? 20, status: options.status })
  }

  async resolveReport(adminId: string, reportId: string, action: 'approved' | 'rejected') {
    const report = await this.adminRepo.findReport(reportId)
    if (!report) throw new NotFoundException('신고를 찾을 수 없습니다')
    await this.adminRepo.resolveReport(reportId, action, adminId)
    if (action === 'approved') {
      if (report.targetType === 'episode') await this.adminRepo.hideEpisode(report.targetId)
      else if (report.targetType === 'comment') await this.adminRepo.deleteCommentById(report.targetId)
    }
    await this.auditLog.log(adminId, 'report_resolve', reportId, { action, targetType: report.targetType, targetId: report.targetId })
    return { resolved: true }
  }

  // ─── 시스템 설정 ───

  async getSettings() { return this.adminRepo.getSettings() }

  async updateSetting(adminId: string, key: string, value: string) {
    await this.adminRepo.updateSetting(key, value, adminId)
    await this.auditLog.log(adminId, 'setting_change', key, { value })
    return { key, value }
  }

  // ─── 시계열 통계 ───

  async getTimeseries(metric: string, days: number = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return this.adminRepo.getTimeseries(metric, since)
  }

  // ─── 공지사항 ───

  async listAnnouncements(page: number = 1, limit: number = 20) { return this.adminRepo.listAnnouncements(page, limit) }

  async createAnnouncement(adminId: string, data: { title: string; content: string; isPinned?: boolean; target?: string }) {
    const item = await this.adminRepo.createAnnouncement(adminId, data)
    await this.auditLog.log(adminId, 'announcement_create', item.id, { title: data.title })
    return item
  }

  async deleteAnnouncement(adminId: string, id: string) {
    await this.adminRepo.deleteAnnouncement(id)
    await this.auditLog.log(adminId, 'announcement_delete', id)
    return { deleted: true }
  }

  // ─── 추천 작품 큐레이션 ───

  async listFeatured(section?: string) { return this.adminRepo.listFeatured(section) }

  async addFeatured(adminId: string, data: { workId: string; section?: string; position?: number }) {
    const item = await this.adminRepo.addFeatured(adminId, data)
    await this.auditLog.log(adminId, 'featured_add', data.workId, { section: data.section })
    return item
  }

  async removeFeatured(adminId: string, id: string) {
    await this.adminRepo.removeFeatured(id)
    await this.auditLog.log(adminId, 'featured_remove', id)
    return { deleted: true }
  }

  // ─── 수익 대시보드 ───

  async getRevenueSummary() { return this.adminRepo.getRevenueSummary() }

  // ─── 테마 프리셋 관리 ───

  async listSystemThemes() { return this.adminRepo.listSystemThemes() }

  async updateSystemTheme(adminId: string, themeId: string, data: { name?: string; overrides?: any }) {
    const theme = await this.adminRepo.findSystemTheme(themeId)
    if (!theme || theme.source !== 'system') throw new NotFoundException('시스템 테마를 찾을 수 없습니다')
    const updated = await this.adminRepo.updateSystemTheme(themeId, data)
    await this.auditLog.log(adminId, 'system_theme_update', themeId, { name: data.name })
    return updated
  }

  async createSystemTheme(adminId: string, data: { name: string; preset: string; overrides: any }) {
    const theme = await this.adminRepo.createSystemTheme(data)
    await this.auditLog.log(adminId, 'system_theme_create', theme.id, { name: data.name, preset: data.preset })
    return theme
  }

  async deleteSystemTheme(adminId: string, themeId: string) {
    const theme = await this.adminRepo.findSystemTheme(themeId)
    if (!theme || theme.source !== 'system') throw new NotFoundException('시스템 테마를 찾을 수 없습니다')
    await this.adminRepo.deleteSystemTheme(themeId)
    await this.auditLog.log(adminId, 'system_theme_delete', themeId, { name: theme.name })
    return { deleted: true }
  }

  // ─── 감사 로그 ───

  async getAuditLogs(options: { page?: number; limit?: number; action?: string }) {
    return this.auditLog.findAll(options)
  }
}
