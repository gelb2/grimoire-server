import { Injectable, Inject } from '@nestjs/common'
import { AuditLogRepositoryPort, AuditEntry } from '@domain/port/outbound/audit-log-repository.port'

// AuditEntry를 re-export (기존 import 호환)
export type { AuditEntry }

/** 관리자 행위 감사 로그 기록/조회 */
@Injectable()
export class AuditLogService {
  constructor(
    @Inject('AuditLogRepositoryPort') private readonly auditLogRepo: AuditLogRepositoryPort,
  ) {}

  async log(adminId: string, action: string, targetId?: string, detail?: Record<string, unknown>): Promise<void> {
    await this.auditLogRepo.create(adminId, action, targetId, detail)
  }

  async findAll(options: { page?: number; limit?: number; action?: string } = {}): Promise<{ items: AuditEntry[]; total: number }> {
    return this.auditLogRepo.findAll(options)
  }
}
