import { Injectable, Inject, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { WebhookRetryQueueRepositoryPort } from '@domain/port/outbound/webhook-retry-queue-repository.port'
import { WebhookEventRepositoryPort } from '@domain/port/outbound/webhook-event-repository.port'
import { AuditLogService } from '@application/admin/audit-log.service'
import { PaymentUseCase } from './payment.usecase'
import { NormalizedWebhookEvent } from '@domain/port/outbound/payment-gateway.port'

/**
 * Sprint PAY-P2-2 — webhook 처리 실패 재시도 cron (정본: `.claude/shared-contracts.md` §18 + `reports/PAY-P2-MASTER-PLAN.md` §4).
 *
 * 5분 주기 cron으로 webhook_retry_queues 테이블의 due row를 재처리.
 *
 * exp backoff 스케줄 (retryCount 기준):
 * - 0 → 1m
 * - 1 → 5m
 * - 2 → 30m
 * - 3 → 2h
 * - 4 → 12h
 * - 5+ → 24h
 *
 * 최대 재시도: 10회. 초과 시 webhook_events 'permanent_failed' 박제 + queue row 삭제 +
 * AuditLog operator='system_dlq' 박제 (운영자 추적용).
 *
 * 외부 인프라 의존 0건 (Postgres 단일 — 절대 규정 0-1 정합).
 *
 * 동시 실행 차단: in-memory `isRunning` 플래그 (replicas ≥2 시점에는 advisory_lock 보강 P2 보류).
 *
 * 비활성화 게이트: process.env.WEBHOOK_RETRY_DISABLED === '1' 즉시 return.
 */
@Injectable()
export class WebhookRetryJob {
  private readonly logger = new Logger(WebhookRetryJob.name)
  /** 동시 실행 차단 플래그 */
  private isRunning = false
  /** 한 번 cron tick에서 처리할 최대 row 수 */
  private static readonly BATCH_SIZE = 100
  /** 최대 재시도 횟수 — 초과 시 permanent_failed 박제 + queue 삭제 */
  private static readonly MAX_RETRY = 10
  /** AuditLog operator (system 식별자) — DLQ 진입 추적 */
  private static readonly DLQ_OPERATOR = 'system_dlq'

  constructor(
    @Inject('WebhookRetryQueueRepositoryPort')
    private readonly retryQueueRepo: WebhookRetryQueueRepositoryPort,
    @Inject('WebhookEventRepositoryPort')
    private readonly webhookEventRepo: WebhookEventRepositoryPort,
    private readonly paymentUseCase: PaymentUseCase,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * cron 진입점 — 5분마다 (cron expression: 0 slash5 * * * *).
   */
  @Cron('0 */5 * * * *')
  async retryDueWebhooks(): Promise<void> {
    if (process.env.WEBHOOK_RETRY_DISABLED === '1') {
      this.logger.warn('WEBHOOK_RETRY_DISABLED=1 — webhook retry cron 비활성화 (skip)')
      return
    }

    if (this.isRunning) {
      this.logger.warn('WebhookRetryJob 이미 실행 중 — 동시 실행 차단 (skip)')
      return
    }

    this.isRunning = true
    let succeededCount = 0
    let retryCount = 0
    let permanentFailedCount = 0
    const startedAt = new Date()

    try {
      this.logger.log(`WebhookRetryJob 시작 — startedAt=${startedAt.toISOString()}`)

      const due = await this.retryQueueRepo.findDue(startedAt, WebhookRetryJob.BATCH_SIZE)

      for (const item of due) {
        try {
          // 재처리 — payload는 NormalizedWebhookEvent 형태로 박제됨
          const event = item.payload as NormalizedWebhookEvent
          await this.paymentUseCase.processNormalizedWebhook(event)

          // 성공 시 row 삭제
          await this.retryQueueRepo.deleteById(item.id)
          succeededCount += 1

          this.logger.log(
            `[retry] eventId=${item.eventId} retryCount=${item.retryCount} → SUCCESS (queue row 삭제)`,
          )
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          const newCount = item.retryCount + 1

          if (newCount >= WebhookRetryJob.MAX_RETRY) {
            // permanent_failed 박제 + queue row 삭제 + AuditLog
            await this.markPermanentFailed(item.eventId, msg)
            await this.retryQueueRepo.deleteById(item.id)
            permanentFailedCount += 1
            this.logger.error(
              `[retry] eventId=${item.eventId} retryCount=${newCount} ≥ ${WebhookRetryJob.MAX_RETRY} → permanent_failed 박제 (queue 삭제)`,
            )
          } else {
            // 다음 재시도 스케줄 갱신
            const nextRetryAt = this.calculateNextRetryAt(newCount)
            await this.retryQueueRepo.markRetry(item.id, msg, nextRetryAt)
            retryCount += 1
            this.logger.warn(
              `[retry] eventId=${item.eventId} retryCount=${newCount} 실패 → 다음 시도 ${nextRetryAt.toISOString()} (${msg.slice(0, 100)})`,
            )
          }
        }
      }

      this.logger.log(
        `WebhookRetryJob 완료 — due=${due.length} success=${succeededCount} retry=${retryCount} permanent=${permanentFailedCount}`,
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error(`WebhookRetryJob 예외 — ${msg}`)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * 재시도 횟수 기준 다음 재시도 시각 계산 (exp backoff).
   * retryCount=1 → 1m, 2 → 5m, 3 → 30m, 4 → 2h, 5 → 12h, 6+ → 24h
   */
  private calculateNextRetryAt(newRetryCount: number): Date {
    const minutesByCount: Record<number, number> = {
      1: 1,
      2: 5,
      3: 30,
      4: 120,
      5: 720,
    }
    const minutes = minutesByCount[newRetryCount] ?? 1440 // 6+ → 24h
    return new Date(Date.now() + minutes * 60_000)
  }

  /**
   * MAX_RETRY 초과 시 permanent_failed 박제 + AuditLog operator='system_dlq'.
   */
  private async markPermanentFailed(eventId: string, lastError: string): Promise<void> {
    try {
      // webhook_events status를 'failed'로 갱신 (이미 'failed'면 무동작)
      await this.webhookEventRepo.markStatus(eventId, 'failed', lastError.slice(0, 500))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.warn(
        `permanent_failed 박제 실패 (webhook_events.markStatus, eventId=${eventId}): ${msg}`,
      )
    }

    try {
      await this.auditLog.log(
        WebhookRetryJob.DLQ_OPERATOR,
        'webhook_permanent_failed',
        eventId,
        {
          reason: 'max_retry_exceeded',
          maxRetry: WebhookRetryJob.MAX_RETRY,
          lastError: lastError.slice(0, 500),
        },
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.warn(`AuditLog system_dlq 박제 실패 (eventId=${eventId}): ${msg}`)
    }
  }
}
