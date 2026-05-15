import { Injectable, Inject, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { WebhookRetryQueueRepositoryPort } from '@domain/port/outbound/webhook-retry-queue-repository.port'
import { WebhookEventRepositoryPort } from '@domain/port/outbound/webhook-event-repository.port'
import { PaymentRepositoryPort } from '@domain/port/outbound/payment-repository.port'
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
  /** PAY-P3-C action — 사전 dedup 차단 영역 식별자 */
  private static readonly DEDUP_ACTION = 'retry_skip_dedup'
  /** PAY-P3-C — 이미 종료된 payment.status (dedup 대상) */
  private static readonly FINALIZED_STATUSES = new Set([
    'completed',
    'refunded',
    'partial_refunded',
  ])

  constructor(
    @Inject('WebhookRetryQueueRepositoryPort')
    private readonly retryQueueRepo: WebhookRetryQueueRepositoryPort,
    @Inject('WebhookEventRepositoryPort')
    private readonly webhookEventRepo: WebhookEventRepositoryPort,
    /**
     * PAY-P3-C — webhook-retry.job 진입 직전 사전 dedup 게이트용 paymentRepo 주입.
     * 정본: `.claude/shared-contracts.md` §23 RetryDeduplication.
     */
    @Inject('PaymentRepositoryPort')
    private readonly paymentRepo: PaymentRepositoryPort,
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
    let skipDedupCount = 0
    const startedAt = new Date()

    try {
      this.logger.log(`WebhookRetryJob 시작 — startedAt=${startedAt.toISOString()}`)

      const due = await this.retryQueueRepo.findDue(startedAt, WebhookRetryJob.BATCH_SIZE)

      for (const item of due) {
        const event = item.payload as NormalizedWebhookEvent

        // PAY-P3-C 모순-D 차단: payment.status 사전 dedup 게이트.
        // (S1 boost 또는 별도 cron으로 status가 이미 완료/환불된 payment의 retry 시도 차단)
        // 정본: shared-contracts §23 RetryDeduplication.
        // - completed / refunded / partial_refunded 상태 → 즉시 deleteById + AuditLog `retry_skip_dedup` + continue
        // - pending / failed / expired / null → 기존 흐름 유지 (processNormalizedWebhook 호출)
        const dedupResult = await this.applyDedupGate(item.id, item.eventId, item.retryCount, event)
        if (dedupResult.skipped) {
          skipDedupCount += 1
          continue
        }

        try {
          // 재처리 — payload는 NormalizedWebhookEvent 형태로 박제됨
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
        `WebhookRetryJob 완료 — due=${due.length} success=${succeededCount} retry=${retryCount} permanent=${permanentFailedCount} dedup=${skipDedupCount}`,
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error(`WebhookRetryJob 예외 — ${msg}`)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * PAY-P3-C 사전 dedup 게이트 — payment.status가 이미 종료된 경우 retry 진입 차단.
   *
   * - findByExternalTransactionId(event.tradeNo)로 payment 조회
   * - payment.status ∈ {'completed', 'refunded', 'partial_refunded'} → 즉시 deleteById + AuditLog `retry_skip_dedup` + skipped=true 반환
   * - 그 외 (pending/failed/expired) 또는 payment 미존재 → 기존 흐름 유지 (skipped=false)
   *
   * AuditLog 박제 실패는 트랜잭션 진행을 막지 않음 (logger.warn 박제 후 skipped=true 보존).
   * 정본: shared-contracts §23 RetryDeduplication.
   */
  private async applyDedupGate(
    queueId: string,
    eventId: string,
    retryCount: number,
    event: NormalizedWebhookEvent,
  ): Promise<{ skipped: boolean }> {
    let payment
    try {
      payment = await this.paymentRepo.findByExternalTransactionId(event.tradeNo)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.warn(
        `[retry] eventId=${eventId} retryCount=${retryCount} → dedup 게이트 조회 실패 (${msg.slice(0, 100)}) — 기존 흐름 유지`,
      )
      return { skipped: false }
    }

    if (!payment) return { skipped: false }
    if (!WebhookRetryJob.FINALIZED_STATUSES.has(payment.status)) return { skipped: false }

    // 사전 dedup 차단 발동 — queue row 즉시 삭제 + AuditLog 박제
    await this.retryQueueRepo.deleteById(queueId)

    try {
      await this.auditLog.log(
        WebhookRetryJob.DLQ_OPERATOR,
        WebhookRetryJob.DEDUP_ACTION,
        eventId,
        {
          reason: 'payment_already_finalized',
          paymentStatus: payment.status,
          retryCount,
          paymentId: payment.id,
        },
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.warn(
        `AuditLog ${WebhookRetryJob.DEDUP_ACTION} 박제 실패 (eventId=${eventId}): ${msg}`,
      )
    }

    this.logger.log(
      `[retry] eventId=${eventId} retryCount=${retryCount} → SKIP_DEDUP (payment.status=${payment.status})`,
    )
    return { skipped: true }
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
