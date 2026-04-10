import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'

export interface AuditEntry {
  id: string
  adminId: string
  action: string
  targetId: string | null
  detail: Record<string, unknown> | null
  createdAt: Date
}

/** 관리자 행위 감사 로그 기록/조회 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** 감사 로그 기록 */
  async log(
    adminId: string,
    action: string,
    targetId?: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetId: targetId ?? null,
        detail: detail ? JSON.parse(JSON.stringify(detail)) : undefined,
      },
    })
  }

  /** 감사 로그 조회 (최신순, 페이지네이션) */
  async findAll(
    options: { page?: number; limit?: number; action?: string } = {},
  ): Promise<{ items: AuditEntry[]; total: number }> {
    const page = options.page ?? 1
    const limit = options.limit ?? 50
    const where = options.action ? { action: options.action } : {}

    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ])

    return { items: items as AuditEntry[], total }
  }
}
