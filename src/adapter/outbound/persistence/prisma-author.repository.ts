import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { Author } from '@domain/model/author'

@Injectable()
export class PrismaAuthorRepository implements AuthorRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Author | null> {
    const row = await this.prisma.author.findUnique({ where: { id } })
    return row ? toDomain(row) : null
  }

  async findBySlug(slug: string): Promise<Author | null> {
    const row = await this.prisma.author.findUnique({ where: { slug } })
    return row ? toDomain(row) : null
  }

  async findByEmail(email: string): Promise<Author | null> {
    const row = await this.prisma.author.findUnique({ where: { email } })
    return row ? toDomain(row) : null
  }

  async create(input: { slug: string; name: string; email: string; passwordHash?: string }): Promise<Author> {
    const row = await this.prisma.author.create({ data: input })
    return toDomain(row)
  }

  async findBySocialAccount(provider: string, providerId: string): Promise<Author | null> {
    const social = await this.prisma.socialAccount.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { author: true },
    })
    return social ? toDomain(social.author) : null
  }

  async updateCredits(id: string, credits: number): Promise<Author> {
    const row = await this.prisma.author.update({
      where: { id },
      data: { credits },
    })
    return toDomain(row)
  }

  async linkSocialAccount(authorId: string, provider: string, providerId: string, email?: string): Promise<void> {
    await this.prisma.socialAccount.create({
      data: { authorId, provider, providerId, providerEmail: email },
    })
  }

  async updateProfile(id: string, data: { name?: string; bio?: string }): Promise<Author> {
    const row = await this.prisma.author.update({
      where: { id },
      data,
    })
    return toDomain(row)
  }

  async search(query: string, limit: number): Promise<Author[]> {
    const rows = await this.prisma.author.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { slug: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toDomain)
  }

  async count(): Promise<number> {
    return this.prisma.author.count()
  }

  async updatePlan(id: string, plan: string, planExpireAt: Date | null): Promise<Author> {
    const row = await this.prisma.author.update({
      where: { id },
      data: { plan, planExpireAt },
    })
    return toDomain(row)
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<Author> {
    const row = await this.prisma.author.update({
      where: { id },
      data: { passwordHash },
    })
    return toDomain(row)
  }

  async findAll(options: { page: number; limit: number; query?: string }): Promise<{ items: Author[]; total: number }> {
    const where = options.query
      ? {
          OR: [
            { name: { contains: options.query, mode: 'insensitive' as const } },
            { slug: { contains: options.query, mode: 'insensitive' as const } },
            { email: { contains: options.query, mode: 'insensitive' as const } },
          ],
        }
      : {}

    const [items, total] = await Promise.all([
      this.prisma.author.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (options.page - 1) * options.limit,
        take: options.limit,
      }),
      this.prisma.author.count({ where }),
    ])

    return { items: items.map(toDomain), total }
  }

  async updateRole(id: string, role: string): Promise<Author> {
    const row = await this.prisma.author.update({
      where: { id },
      data: { role },
    })
    return toDomain(row)
  }

  /**
   * USER-SOFT-DELETE sprint (2026-05-15) 정합:
   * - middleware 영역 영역 hard delete → soft delete (UPDATE deletedAt) 변환 강제
   * - 운영자 영역 강제 hard delete 영역 = 30일 cron 영역만 강제
   */
  async deleteById(id: string): Promise<void> {
    // 본인 탈퇴 / 운영자 강제 삭제 영역 → middleware 영역 영역 soft delete 영역 변환 영역
    // (직접 hard delete 영역 호출 영역 차단 정합 — middleware 영역 자동 변환)
    await this.prisma.author.delete({ where: { id } })
  }

  async updateDefaultThemeId(id: string, themeId: string | null): Promise<Author> {
    const row = await this.prisma.author.update({
      where: { id },
      data: { defaultThemeId: themeId },
    })
    return toDomain(row)
  }

  // ─── USER-SOFT-DELETE sprint (2026-05-15) ───

  /**
   * Author soft delete 영역 명시 영역 (deletedAt = NOW).
   * middleware 영역 영역 자동 변환 영역 — 본 메서드 영역 = 명시 영역 강제 영역.
   */
  async softDelete(id: string): Promise<void> {
    await this.prisma.author.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  }

  /**
   * Author soft delete 영역 복구 영역 (deletedAt = null).
   * 운영자 영역 명시 영역만 — middleware 영역 우회 강제 (raw update 영역).
   */
  async restore(id: string): Promise<void> {
    // middleware 영역 영역 WHERE deletedAt: null 영역 자동 적용 영역 → 직접 update 영역 호출 영역 차단 영역
    // raw query 영역 영역 우회 강제
    await this.prisma.$executeRaw`
      UPDATE "authors" SET "deleted_at" = NULL WHERE "id" = ${id}::uuid
    `
  }

  /**
   * 30일 cron 영역 영역 영역 hard delete 영역.
   * 회계 8건 Restrict 영역 영역 P2003 영역 try-catch 영역 → blockedIds 영역 박제.
   */
  async hardDeleteOlderThan(cutoff: Date): Promise<{
    deletedIds: string[]
    blockedIds: string[]
  }> {
    // 1. cutoff 영역 영역 조회 영역 (middleware 영역 우회 — raw query 영역)
    const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "authors"
      WHERE "deleted_at" IS NOT NULL AND "deleted_at" < ${cutoff}
    `

    const deletedIds: string[] = []
    const blockedIds: string[] = []

    // 2. row 영역 영역 hard delete 영역 시도 영역 — P2003 영역 try-catch 영역
    for (const { id } of candidates) {
      try {
        // middleware 영역 영역 delete → soft delete 영역 변환 영역 → raw query 영역 영역 강제 hard delete 영역
        await this.prisma.$executeRaw`
          DELETE FROM "authors" WHERE "id" = ${id}::uuid
        `
        deletedIds.push(id)
      } catch (error: unknown) {
        // P2003 영역 영역 회계 Restrict 영역 영역 차단 영역 → blockedIds 영역 박제 영역
        const errCode = (error as { code?: string })?.code
        const errMsg = (error as { message?: string })?.message ?? ''
        if (errCode === 'P2003' || errMsg.includes('foreign key') || errMsg.includes('Foreign key')) {
          blockedIds.push(id)
        } else {
          // 영역 영역 영역 영역 예외 영역 — 영역 영역 영역 영역 throw 강제 영역 영역
          throw error
        }
      }
    }

    return { deletedIds, blockedIds }
  }

  /**
   * deletedAt = NOT NULL 영역 영역 영역 영역 조회 영역 (운영자 영역).
   * middleware 영역 영역 우회 — raw query 영역 영역.
   */
  async findDeletedById(id: string): Promise<Author | null> {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string
      slug: string
      name: string
      email: string
      password_hash: string | null
      bio: string | null
      role: string
      credits: number
      plan: string
      plan_expire_at: Date | null
      default_theme_id: string | null
      created_at: Date
      deleted_at: Date | null
      points_free: number | null
      points_subscription: number | null
      points_gift: number | null
      points_charged: number | null
      deficit_points: number | null
    }>>`
      SELECT * FROM "authors" WHERE "id" = ${id}::uuid AND "deleted_at" IS NOT NULL
    `
    if (rows.length === 0) return null
    const row = rows[0]
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      email: row.email,
      passwordHash: row.password_hash ?? undefined,
      bio: row.bio ?? undefined,
      role: row.role,
      credits: row.credits,
      plan: row.plan,
      planExpireAt: row.plan_expire_at ?? null,
      defaultThemeId: row.default_theme_id ?? null,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      // 크레딧 개편 I Phase — 신 4 출처 캐시 + deficit (raw query SELECT * snake_case)
      pointsFree: row.points_free ?? 0,
      pointsSubscription: row.points_subscription ?? 0,
      pointsGift: row.points_gift ?? 0,
      pointsCharged: row.points_charged ?? 0,
      deficitPoints: row.deficit_points ?? 0,
    }
  }

  /**
   * soft deleted Author 영역 영역 cutoff 영역 영역 조회 영역 (cron 영역 영역 정합).
   * middleware 영역 영역 우회 — raw query 영역.
   */
  async findDeletedOlderThan(cutoff: Date): Promise<Author[]> {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string
      slug: string
      name: string
      email: string
      password_hash: string | null
      bio: string | null
      role: string
      credits: number
      plan: string
      plan_expire_at: Date | null
      default_theme_id: string | null
      created_at: Date
      deleted_at: Date | null
      points_free: number | null
      points_subscription: number | null
      points_gift: number | null
      points_charged: number | null
      deficit_points: number | null
    }>>`
      SELECT * FROM "authors"
      WHERE "deleted_at" IS NOT NULL AND "deleted_at" < ${cutoff}
    `
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      email: row.email,
      passwordHash: row.password_hash ?? undefined,
      bio: row.bio ?? undefined,
      role: row.role,
      credits: row.credits,
      plan: row.plan,
      planExpireAt: row.plan_expire_at ?? null,
      defaultThemeId: row.default_theme_id ?? null,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      // 크레딧 개편 I Phase — 신 4 출처 캐시 + deficit (raw query SELECT * snake_case)
      pointsFree: row.points_free ?? 0,
      pointsSubscription: row.points_subscription ?? 0,
      pointsGift: row.points_gift ?? 0,
      pointsCharged: row.points_charged ?? 0,
      deficitPoints: row.deficit_points ?? 0,
    }))
  }
}

function toDomain(row: {
  id: string
  slug: string
  name: string
  email: string
  passwordHash?: string | null
  bio?: string | null
  role: string
  credits: number
  plan: string
  planExpireAt?: Date | null
  defaultThemeId?: string | null
  createdAt: Date
  deletedAt?: Date | null
  // 크레딧 개편 I Phase — 4 출처 캐시 + deficit (schema @default(0))
  pointsFree?: number
  pointsSubscription?: number
  pointsGift?: number
  pointsCharged?: number
  deficitPoints?: number
}): Author {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash ?? undefined,
    bio: row.bio ?? undefined,
    role: row.role,
    credits: row.credits,
    plan: row.plan,
    planExpireAt: row.planExpireAt ?? null,
    defaultThemeId: row.defaultThemeId ?? null,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt ?? null,
    // 크레딧 개편 I Phase — 신 4 출처 캐시 + deficit. select 미포함 시 0 fallback.
    pointsFree: row.pointsFree ?? 0,
    pointsSubscription: row.pointsSubscription ?? 0,
    pointsGift: row.pointsGift ?? 0,
    pointsCharged: row.pointsCharged ?? 0,
    deficitPoints: row.deficitPoints ?? 0,
  }
}
