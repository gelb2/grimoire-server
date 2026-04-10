import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { AuditLogService } from './audit-log.service'
import { CreditLog } from '@domain/model/credit'
import { Author } from '@domain/model/author'

@Injectable()
export class AdminUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('CreditRepositoryPort') private readonly creditRepo: CreditRepositoryPort,
    private readonly creditUseCase: CreditUseCase,
    private readonly auditLog: AuditLogService,
  ) {}

  // ─── 통계 ───

  async getStats() {
    const [totalAuthors, totalWorks, totalEpisodes, totalCreditsConsumed] = await Promise.all([
      this.authorRepo.count(),
      this.workRepo.countAll(),
      this.workRepo.countAllEpisodes(),
      this.creditRepo.sumNegativeAmounts(),
    ])
    return {
      totalAuthors,
      totalWorks,
      totalEpisodes,
      totalCreditsConsumed: Math.abs(totalCreditsConsumed),
    }
  }

  // ─── 사용자 관리 ───

  /** 작가 목록 조회 (검색/페이지네이션) */
  async listAuthors(options: { page?: number; limit?: number; query?: string }) {
    return this.authorRepo.findAll({
      page: options.page ?? 1,
      limit: options.limit ?? 20,
      query: options.query,
    })
  }

  /** 작가 상세 조회 */
  async getAuthor(authorId: string): Promise<Author> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    return author
  }

  /** 관리자가 작가 계정 생성 */
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
      slug: input.slug,
      name: input.name,
      email: input.email,
      passwordHash,
    })

    if (input.plan && input.plan !== 'free') {
      await this.authorRepo.updatePlan(author.id, input.plan, null)
    }

    await this.auditLog.log(adminId, 'author_create', author.id, {
      slug: input.slug, email: input.email, plan: input.plan ?? 'free',
    })

    return author
  }

  /** 작가 정보 수정 (이름, bio, 슬러그) */
  async updateAuthor(
    adminId: string,
    authorId: string,
    data: { name?: string; bio?: string },
  ): Promise<Author> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    const updated = await this.authorRepo.updateProfile(authorId, data)

    await this.auditLog.log(adminId, 'author_update', authorId, {
      before: { name: author.name, bio: author.bio },
      after: data,
    })

    return updated
  }

  /** 작가 삭제 */
  async deleteAuthor(adminId: string, authorId: string): Promise<void> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')
    if (author.role === 'admin') throw new BadRequestException('관리자 계정은 삭제할 수 없습니다')

    await this.authorRepo.deleteById(authorId)

    await this.auditLog.log(adminId, 'author_delete', authorId, {
      slug: author.slug, email: author.email, name: author.name,
    })
  }

  /** 역할 변경 (user ↔ admin) */
  async changeRole(adminId: string, authorId: string, role: string): Promise<Author> {
    if (!['user', 'admin'].includes(role)) {
      throw new BadRequestException('유효한 역할: user, admin')
    }
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    const updated = await this.authorRepo.updateRole(authorId, role)

    await this.auditLog.log(adminId, 'role_change', authorId, {
      before: author.role, after: role,
    })

    return updated
  }

  // ─── 크레딧 관리 ───

  /** 크레딧 부여 */
  async grantCredits(
    adminId: string,
    authorId: string,
    amount: number,
    reason: string,
  ): Promise<{ credits: number; log: CreditLog }> {
    const result = await this.creditUseCase.grant(authorId, amount, `admin_grant:${reason}`)

    await this.auditLog.log(adminId, 'credit_grant', authorId, { amount, reason })

    return result
  }

  /** 크레딧 차감 */
  async deductCredits(
    adminId: string,
    authorId: string,
    amount: number,
    reason: string,
  ): Promise<{ credits: number; log: CreditLog }> {
    const result = await this.creditUseCase.deduct(authorId, amount, `admin_deduct:${reason}`)

    await this.auditLog.log(adminId, 'credit_deduct', authorId, { amount, reason })

    return result
  }

  /** 전체 크레딧 이력 조회 */
  async getAllCreditLogs(authorId?: string) {
    if (authorId) {
      return this.creditRepo.findLogsByAuthorId(authorId)
    }
    // 전체 조회는 별도 쿼리 필요 — 추후 확장
    return []
  }

  // ─── 플랜 관리 ───

  /** 플랜 변경 */
  async changePlan(
    adminId: string,
    authorId: string,
    plan: string,
    durationDays: number,
  ): Promise<void> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    const planExpireAt = durationDays > 0
      ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
      : null
    await this.authorRepo.updatePlan(authorId, plan, planExpireAt)

    await this.auditLog.log(adminId, 'plan_change', authorId, {
      before: { plan: author.plan, planExpireAt: author.planExpireAt },
      after: { plan, durationDays },
    })
  }

  // ─── 결제 관리 ───

  /** 전체 결제 내역 조회 */
  async getAllPayments(page: number = 1, limit: number = 50) {
    // PrismaService 직접 사용 — PaymentRepositoryPort 없으므로
    // AdminUseCase는 인프라 직접 참조 허용 (관리자 전용 읽기)
    return { items: [], total: 0 } // 추후 구현
  }

  // ─── 감사 로그 조회 ───

  async getAuditLogs(options: { page?: number; limit?: number; action?: string }) {
    return this.auditLog.findAll(options)
  }
}
