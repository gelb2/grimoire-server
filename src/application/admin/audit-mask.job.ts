import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { Prisma } from '@prisma/client'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import {
  maskJsonDeep,
  maskAccessLogRow,
  type MaskingResult,
} from '@adapter/outbound/persistence/audit-mask-helper'

/**
 * Sprint PAY-P2-5 — audit retention 정책 (영구 보존 + 90일 후 PII 마스킹).
 *
 * 사용자 결정 옵션 D (5/10 verbatim "d로 하고"):
 * - 영구 보존 (DELETE 0건 강제)
 * - 90일 경과 row → PII 자동 마스킹
 * - audit 본질 보존 (id/userId/authorId/adminId/action/createdAt 영역 유지)
 *
 * 4 모델: AdminAuditLog / WebhookEvent / WebhookRetryQueue / AccessLog
 *
 * cron: 매일 새벽 3시 (KST), '0 0 3 * * *'
 *  - PaymentReconciliation cron (10분 주기)와 시간대 분리
 *  - PaymentCleanup cron (4시 1회)와 시간대 분리
 *
 * 멱등성:
 *  - WHERE retentionTier='active' AND created_at < NOW() - INTERVAL '90 days'
 *  - 마스킹 성공 시 retentionTier='masked' + maskedAt=NOW() 갱신
 *  - 다음 cron에서 동일 row 재선택 0건 강제
 *
 * 비활성화 게이트:
 *  - process.env.AUDIT_MASK_DISABLED === '1' 즉시 return
 *
 * 정본: `.claude/shared-contracts.md` §26 AuditRetentionPolicy
 */
@Injectable()
export class AuditMaskJob {
  private readonly logger = new Logger(AuditMaskJob.name)
  /** 동시 실행 차단 플래그 — 같은 process 내에서 cron 중복 호출 방지 */
  private isRunning = false
  /** 마스킹 cutoff — 90일 경과 row 대상 */
  private static readonly MASK_AFTER_DAYS = 90

  constructor(private readonly prisma: PrismaService) {}

  /**
   * cron 진입점 — 매일 새벽 3시 KST.
   */
  @Cron('0 0 3 * * *')
  async maskExpiredAuditRows(): Promise<void> {
    if (process.env.AUDIT_MASK_DISABLED === '1') {
      this.logger.warn('AUDIT_MASK_DISABLED=1 — audit-mask cron 비활성화 (skip)')
      return
    }

    if (this.isRunning) {
      this.logger.warn('AuditMaskJob 이미 실행 중 — 동시 실행 차단 (skip)')
      return
    }

    this.isRunning = true
    const startedAt = new Date()
    const cutoff = new Date(
      startedAt.getTime() - AuditMaskJob.MASK_AFTER_DAYS * 24 * 60 * 60 * 1000,
    )

    try {
      this.logger.log(
        `AuditMaskJob 시작 — startedAt=${startedAt.toISOString()} cutoff=${cutoff.toISOString()} (${AuditMaskJob.MASK_AFTER_DAYS}일 경과)`,
      )

      const result = await this.runMaskingPass(cutoff)

      this.logger.log(
        `AuditMaskJob 완료 — modelsProcessed=${result.modelsProcessed.join(',')} rowsMasked=${result.rowsMasked} rowsSkipped=${result.rowsSkipped} errors=${result.errors.length}`,
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error(`AuditMaskJob 예외 — ${msg}`)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * 4 모델 마스킹 1회 수행. 직접 호출 가능 (단계 7 dev cron 직접 호출 검증용).
   */
  async runMaskingPass(cutoff: Date): Promise<MaskingResult> {
    const result: MaskingResult = {
      modelsProcessed: [],
      rowsMasked: 0,
      rowsSkipped: 0,
      errors: [],
    }

    // 1) AdminAuditLog
    const adminRows = await this.prisma.adminAuditLog.findMany({
      where: {
        retentionTier: 'active',
        createdAt: { lt: cutoff },
      },
      select: { id: true, detail: true },
    })
    for (const row of adminRows) {
      try {
        const masked = row.detail === null ? null : maskJsonDeep(row.detail)
        await this.prisma.adminAuditLog.update({
          where: { id: row.id },
          data: {
            detail:
              masked === null
                ? Prisma.JsonNull
                : (masked as Prisma.InputJsonValue),
            maskedAt: new Date(),
            retentionTier: 'masked',
          },
        })
        result.rowsMasked += 1
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        result.errors.push({ rowId: row.id, error: msg })
        this.logger.error(`[admin_audit_logs] rowId=${row.id} 마스킹 실패 — ${msg}`)
      }
    }
    result.modelsProcessed.push('admin_audit_logs')

    // 2) WebhookEvent
    const webhookRows = await this.prisma.webhookEvent.findMany({
      where: {
        retentionTier: 'active',
        processedAt: { lt: cutoff },
      },
      select: { id: true, payload: true, errorMessage: true },
    })
    for (const row of webhookRows) {
      try {
        const maskedPayload = maskJsonDeep(row.payload)
        await this.prisma.webhookEvent.update({
          where: { id: row.id },
          data: {
            payload: maskedPayload as Prisma.InputJsonValue,
            errorMessage: row.errorMessage ? '***' : null,
            maskedAt: new Date(),
            retentionTier: 'masked',
          },
        })
        result.rowsMasked += 1
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        result.errors.push({ rowId: row.id, error: msg })
        this.logger.error(`[webhook_events] rowId=${row.id} 마스킹 실패 — ${msg}`)
      }
    }
    result.modelsProcessed.push('webhook_events')

    // 3) WebhookRetryQueue
    const retryRows = await this.prisma.webhookRetryQueue.findMany({
      where: {
        retentionTier: 'active',
        createdAt: { lt: cutoff },
      },
      select: { id: true, payload: true, lastError: true },
    })
    for (const row of retryRows) {
      try {
        const maskedPayload = maskJsonDeep(row.payload)
        await this.prisma.webhookRetryQueue.update({
          where: { id: row.id },
          data: {
            payload: maskedPayload as Prisma.InputJsonValue,
            lastError: row.lastError ? '***' : null,
            maskedAt: new Date(),
            retentionTier: 'masked',
          },
        })
        result.rowsMasked += 1
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        result.errors.push({ rowId: row.id, error: msg })
        this.logger.error(`[webhook_retry_queues] rowId=${row.id} 마스킹 실패 — ${msg}`)
      }
    }
    result.modelsProcessed.push('webhook_retry_queues')

    // 4) AccessLog
    const accessRows = await this.prisma.accessLog.findMany({
      where: {
        retentionTier: 'active',
        createdAt: { lt: cutoff },
      },
      select: { id: true, email: true, ip: true, userAgent: true, detail: true },
    })
    for (const row of accessRows) {
      try {
        const masked = maskAccessLogRow({
          email: row.email,
          ip: row.ip,
          userAgent: row.userAgent,
          detail: row.detail,
        })
        await this.prisma.accessLog.update({
          where: { id: row.id },
          data: {
            email: masked.email,
            ip: masked.ip,
            userAgent: masked.userAgent,
            detail: masked.detail,
            maskedAt: new Date(),
            retentionTier: 'masked',
          },
        })
        result.rowsMasked += 1
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        result.errors.push({ rowId: row.id, error: msg })
        this.logger.error(`[access_logs] rowId=${row.id} 마스킹 실패 — ${msg}`)
      }
    }
    result.modelsProcessed.push('access_logs')

    return result
  }
}
