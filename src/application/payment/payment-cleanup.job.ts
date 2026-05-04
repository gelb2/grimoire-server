import { Injectable, Inject, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PaymentRepositoryPort } from '@domain/port/outbound/payment-repository.port'
import { AuditLogService } from '@application/admin/audit-log.service'

/**
 * Sprint PAY-P1-3 — 결제 실패 retry 정책 만료 cron (정본: `.claude/shared-contracts.md` §14).
 *
 * 매일 새벽 4시 cron으로 24h 초과 pending Payment를 'expired' 마킹.
 * (PAY-P0-2 reconciliation cron은 새벽 3시 + 10분 주기 — 본 cleanup은 4시 1회만, 시간대/주기 분리)
 *
 * 사용 케이스:
 * - PAY-P0-2 reconciliation cron이 PG list 기반으로 일부 expire를 처리하지만,
 *   PG에 record가 아예 없는 (사용자가 결제 페이지 진입조차 안 한) 24h 초과 row를 추가 정리.
 * - PAY-P1-3 재사용 정책 진입 게이트의 24h cutoff와 정합 — 재사용 후보에서 제외된 row를 명시적으로 expired 마킹.
 *
 * 동시 실행 차단:
 * - in-memory `isRunning` 플래그 + try-finally lock 해제
 * - replicas ≥2 시점에는 advisory_lock 보강 (P2 보류)
 *
 * AuditLog operator='system_cleanup' (PAY-P0-2 'system_reconciliation'과 분리 — 운영자 식별 용이).
 *
 * 비활성화 게이트:
 * - process.env.PAYMENT_CLEANUP_DISABLED === '1' 즉시 return (운영자 수동 차단용)
 */
@Injectable()
export class PaymentCleanupJob {
  private readonly logger = new Logger(PaymentCleanupJob.name)
  /** 동시 실행 차단 플래그 — 같은 process 내에서 cron 중복 호출 방지 */
  private isRunning = false
  /** expire 기준 — pending 24h 경과 (PAY-P1-3 재사용 정책 cutoff와 정합) */
  private static readonly PENDING_EXPIRE_HOURS = 24
  /** AuditLog operator (system 식별자) — PAY-P0-2 'system_reconciliation'과 구분 */
  private static readonly CLEANUP_OPERATOR = 'system_cleanup'

  constructor(
    @Inject('PaymentRepositoryPort') private readonly paymentRepo: PaymentRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * cron 진입점 — 매일 새벽 4시 (cron expression: '0 0 4 * * *').
   * PAY-P0-2 reconciliation cron은 10분 주기 — 본 cleanup은 일 1회만 (시간대/주기 분리).
   */
  @Cron('0 0 4 * * *')
  async cleanupExpiredPendingPayments(): Promise<void> {
    if (process.env.PAYMENT_CLEANUP_DISABLED === '1') {
      this.logger.warn('PAYMENT_CLEANUP_DISABLED=1 — cleanup cron 비활성화 (skip)')
      return
    }

    if (this.isRunning) {
      this.logger.warn('PaymentCleanupJob 이미 실행 중 — 동시 실행 차단 (skip)')
      return
    }

    this.isRunning = true
    let expireCount = 0
    const startedAt = new Date()

    try {
      this.logger.log(
        `PaymentCleanupJob 시작 — startedAt=${startedAt.toISOString()} expireHours=${PaymentCleanupJob.PENDING_EXPIRE_HOURS}`,
      )

      const stalePending = await this.paymentRepo.findPendingPaymentsOlderThan(
        PaymentCleanupJob.PENDING_EXPIRE_HOURS,
      )

      for (const payment of stalePending) {
        try {
          await this.paymentRepo.expirePayment(payment.id)

          // elapsedHours 계산 — 24h 초과 시점 명시 (감사 시 분석 용이)
          const elapsedMs = startedAt.getTime() - payment.createdAt.getTime()
          const elapsedHours = Math.round((elapsedMs / (60 * 60 * 1000)) * 10) / 10

          await this.auditLog.log(
            PaymentCleanupJob.CLEANUP_OPERATOR,
            'payment_expire',
            payment.id,
            {
              reason: 'pending_24h_cleanup',
              authorId: payment.authorId,
              productId: payment.productId,
              createdAt: payment.createdAt.toISOString(),
              elapsedHours,
            },
          )
          expireCount += 1

          this.logger.log(
            `[cleanup] paymentId=${payment.id} authorId=${payment.authorId} elapsed=${elapsedHours}h → expired`,
          )
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          this.logger.error(`[cleanup] paymentId=${payment.id} expire 실패 — ${msg}`)
          // 본 row만 실패 박제 — 다음 cron에서 재시도. 다른 row 처리 계속.
        }
      }

      this.logger.log(
        `PaymentCleanupJob 완료 — expireCount=${expireCount} stalePendingCount=${stalePending.length}`,
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error(`PaymentCleanupJob 예외 — ${msg}`)
    } finally {
      this.isRunning = false
    }
  }
}
