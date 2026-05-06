import { Injectable, Inject } from '@nestjs/common'
import { AuditLogRepositoryPort, AuditEntry } from '@domain/port/outbound/audit-log-repository.port'

// AuditEntry를 re-export (기존 import 호환)
export type { AuditEntry }

/**
 * 관리자 행위 감사 로그 기록/조회.
 *
 * Sprint PAY-P2-4 (2026-05-06) — beforeState/afterState 강제 박제 시그니처 확장.
 * - 기존 4-arg 호출 (admin.usecase 22개 + payment-reconciliation.job 3개 + webhook-retry.job 1개) 모두 BACKWARD COMPATIBLE.
 * - 6/7-arg 호출 시 detail JSON에 표준 키 (`beforeState` / `afterState`)로 박제.
 * - undefined 인자는 detail에 키 미박제 (키 누설 차단).
 *
 * 정본: `.claude/shared-contracts.md` §20 AdminAuditLog beforeState/afterState Convention
 */
@Injectable()
export class AuditLogService {
  constructor(
    @Inject('AuditLogRepositoryPort') private readonly auditLogRepo: AuditLogRepositoryPort,
  ) {}

  async log(
    adminId: string,
    action: string,
    targetId?: string,
    detail?: Record<string, unknown>,
    beforeState?: Record<string, unknown>,
    afterState?: Record<string, unknown>,
  ): Promise<void> {
    // 표준 detail 병합 (PAY-P2-4):
    // - beforeState/afterState undefined → detail JSON에 키 미박제 (BACKWARD COMPATIBILITY)
    // - 정의 시만 spread → 키 누설 차단 (`undefined` 값 박제 차단)
    const hasBefore = beforeState !== undefined
    const hasAfter = afterState !== undefined
    const enrichedDetail =
      detail === undefined && !hasBefore && !hasAfter
        ? undefined
        : {
            ...(detail ?? {}),
            ...(hasBefore ? { beforeState } : {}),
            ...(hasAfter ? { afterState } : {}),
          }
    await this.auditLogRepo.create(adminId, action, targetId, enrichedDetail)
  }

  async findAll(options: { page?: number; limit?: number; action?: string } = {}): Promise<{ items: AuditEntry[]; total: number }> {
    return this.auditLogRepo.findAll(options)
  }
}
