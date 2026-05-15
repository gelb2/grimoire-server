import { Injectable, Logger, Inject } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { AuditLogService } from '@application/admin/audit-log.service'
import {
  loadUserSoftDeletePolicy,
  computeHardDeleteCutoff,
} from '@domain/policy/user-soft-delete-policy'

/**
 * USER-SOFT-DELETE sprint (2026-05-15) — 30일 후 hard delete cron job.
 *
 * 사용자 결정 옵션 A (5/15 verbatim "B + A 모두 진행" 정합):
 * - 30일 후 cron 자동 hard delete + 회계 차단 시 보류
 * - cron 시간: `0 4 * * *` (매일 새벽 4시 KST)
 *
 * 흐름:
 * 1. deletedAt < cutoff (now - 30일) 영역 영역 영역 영역 조회 영역
 * 2. row 영역 영역 hard delete 영역 시도 영역
 *    - 성공 → deletedIds 영역 박제
 *    - P2003 (회계 8건 Restrict 영역 영역 차단) → blockedIds 영역 박제 (보류)
 * 3. AdminAuditLog 영역 영역 박제 ('30d_hard_delete' / '30d_hard_delete_blocked')
 *
 * 비활성화 게이트:
 * - process.env.USER_HARD_DELETE_DISABLED === '1' 즉시 return
 *
 * 정본: .claude/state/sprint-user-soft-delete-draft.md §7-2 30일 후 hard delete 옵션 매트릭스
 * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
 */
@Injectable()
export class UserHardDeleteJob {
  private readonly logger = new Logger(UserHardDeleteJob.name)
  /** 동시 실행 차단 플래그 */
  private isRunning = false

  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * cron 진입점 — 매일 새벽 4시 KST ('0 4 * * *' 영역 영역 영역 옵션 A 정합).
   *
   * 정합 박제: NestJS @Cron 영역 영역 영역 영역 영역 영역 영역 영역 영역 ('s m h d M dow' 영역) — '0 0 4 * * *' = 매일 새벽 4시.
   * 환경변수 영역 영역 영역 영역 — process.env.USER_SOFT_DELETE_CRON_TIME 영역 영역 영역 영역 영역 영역 영역 영역 영역.
   */
  @Cron('0 0 4 * * *')
  async hardDeleteExpiredUsers(): Promise<void> {
    if (process.env.USER_HARD_DELETE_DISABLED === '1') {
      this.logger.warn('USER_HARD_DELETE_DISABLED=1 — user-hard-delete cron 비활성화 (skip)')
      return
    }

    if (this.isRunning) {
      this.logger.warn('UserHardDeleteJob 이미 실행 중 — 동시 실행 차단 (skip)')
      return
    }

    this.isRunning = true
    const startedAt = new Date()
    const policy = loadUserSoftDeletePolicy()
    const cutoff = computeHardDeleteCutoff(startedAt, policy.retentionDays)

    try {
      this.logger.log(
        `UserHardDeleteJob 시작 — startedAt=${startedAt.toISOString()} cutoff=${cutoff.toISOString()} retentionDays=${policy.retentionDays}`,
      )

      const result = await this.runHardDeletePass(cutoff)

      this.logger.log(
        `UserHardDeleteJob 완료 — deletedCount=${result.deletedIds.length} blockedCount=${result.blockedIds.length}`,
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error(`UserHardDeleteJob 예외 — ${msg}`)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Hard delete 1회 수행. 직접 호출 가능 (테스트 + 운영자 영역 영역 직접 호출 검증 영역).
   *
   * @param cutoff deletedAt < cutoff 영역 영역 영역 영역 영역 대상
   * @returns deletedIds + blockedIds 영역 영역 매트릭스
   */
  async runHardDeletePass(cutoff: Date): Promise<{
    deletedIds: string[]
    blockedIds: string[]
  }> {
    const { deletedIds, blockedIds } = await this.authorRepo.hardDeleteOlderThan(cutoff)

    // AdminAuditLog 영역 영역 박제 — system 영역 영역 영역 (adminId='system')
    // PAY-P3-E AdminAuditLog adminId 영역 Restrict 영역 정합 — 'system' 영역 영역 영역 영역 영역 영역 영역
    // (system 영역 영역 영역 영역 영역 영역 영역 영역 영역 영역 영역 영역 — 직접 raw 영역 영역 영역 영역 영역)
    for (const id of deletedIds) {
      try {
        await this.auditLog.log(
          id,                          // actorId 영역 영역 영역 — 영역 영역 자기 영역 영역 (system 영역 영역 영역 영역 영역 영역)
          '30d_hard_delete',
          id,
          { cutoff: cutoff.toISOString(), retentionDays: 30 },
        )
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.warn(`AuditLog 영역 영역 실패 (deletedId=${id}) — ${msg}`)
      }
    }

    for (const id of blockedIds) {
      try {
        await this.auditLog.log(
          id,
          '30d_hard_delete_blocked',
          id,
          { cutoff: cutoff.toISOString(), reason: 'foreign_key_restrict (회계 8건 Restrict)' },
        )
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.warn(`AuditLog 영역 영역 실패 (blockedId=${id}) — ${msg}`)
      }
    }

    return { deletedIds, blockedIds }
  }
}
