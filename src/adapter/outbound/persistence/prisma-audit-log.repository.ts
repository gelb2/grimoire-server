import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { AuditLogRepositoryPort, AuditEntry } from '@domain/port/outbound/audit-log-repository.port'

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(adminId: string, action: string, targetId?: string, detail?: Record<string, unknown>): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetId: targetId ?? null,
        detail: detail ? JSON.parse(JSON.stringify(detail)) : undefined,
      },
    })
  }

  async findAll(options: { page?: number; limit?: number; action?: string }): Promise<{ items: AuditEntry[]; total: number }> {
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
