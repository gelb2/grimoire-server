import { Injectable, Inject, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  PaymentGatewayPort,
  NormalizedCheckout,
} from '@domain/port/outbound/payment-gateway.port'
import {
  PaymentRepositoryPort,
  PaymentRecord,
} from '@domain/port/outbound/payment-repository.port'
import { ReconciliationCheckpointRepositoryPort } from '@domain/port/outbound/reconciliation-checkpoint-repository.port'
import { AuditLogService } from '@application/admin/audit-log.service'

/**
 * PG↔DB 정합성 검증 cron — Sprint PAY-P0-2 (2026-05-03).
 *
 * 10분 주기 (cost-accountant 권고 기반 기본값):
 * - Polar API rate limit 분당 500회 default 그룹 → 10분 cron 사용률 1% 미만, 안전 마진 100배+
 *
 * 4 시나리오:
 * - S1 PG=succeeded + DB=pending → completePaymentWithPoints + AuditLog `reconciliation_boost`
 * - S2 PG=refunded + DB=completed → logger.warn + AuditLog `reconciliation_refund_mismatch` (실제 환수 0건, P1-1 위임)
 * - S3 PG=NotFound + DB=pending(24h 경과) → expirePayment + AuditLog `reconciliation_expire`
 * - S4 PG ↔ DB 정합 → skip
 *
 * amount 안전망 (R2, 2026-06-27 — 진단 §2 #2):
 * - status 조합만 비교하면 R1류 이중적립(같은 status, 잔액만 2배)을 사후에 탐지하지 못한다.
 * - 매 PG↔DB 매칭 row 마다 `pgCheckout.amount` vs `dbPayment.amount` 를 비교 →
 *   불일치 시 logger.warn + AuditLog `reconciliation_amount_mismatch` (탐지·기록만, 자동
 *   환수 0건 — S2 와 동일 "기록 후 운영자 위임" 정책). 운영자가 R1류를 사후 인지 가능.
 *

 * 동시 cron 차단:
 * - in-memory `isRunning` 플래그 + try-finally lock 해제
 * - replicas ≥2 시점에는 advisory_lock 보강 (PAY-P1)
 *
 * AuditLog operator: 'system_reconciliation' (string).
 *
 * 비활성화 게이트:
 * - process.env.RECONCILIATION_DISABLED === '1'면 즉시 return (운영자 수동 차단용).
 */
@Injectable()
export class PaymentReconciliationJob {
  private readonly logger = new Logger(PaymentReconciliationJob.name)
  /** 동시 실행 차단 플래그 — 같은 process 내에서 cron 중복 호출 방지 */
  private isRunning = false
  /** S3 expire 기준 — pending 24h 경과 */
  private static readonly PENDING_EXPIRE_HOURS = 24
  /** Polar list API 페이지당 row 수 */
  private static readonly POLAR_LIMIT = 100
  /** AuditLog operator (system 식별자) */
  private static readonly RECONCILIATION_OPERATOR = 'system_reconciliation'

  constructor(
    @Inject('PaymentGatewayPort') private readonly paymentGateway: PaymentGatewayPort,
    @Inject('PaymentRepositoryPort') private readonly paymentRepo: PaymentRepositoryPort,
    @Inject('ReconciliationCheckpointRepositoryPort')
    private readonly checkpointRepo: ReconciliationCheckpointRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * cron 진입점 — 10분 주기.
   * cost-accountant 권고 기반 기본값. 변경 시 sprint progress §3-5 정본 갱신.
   */
  @Cron('0 */10 * * * *')
  async run(): Promise<void> {
    if (process.env.RECONCILIATION_DISABLED === '1') {
      this.logger.warn('RECONCILIATION_DISABLED=1 — cron 비활성화 (skip)')
      return
    }

    if (this.isRunning) {
      this.logger.warn(
        'PaymentReconciliationJob 이미 실행 중 — 동시 실행 차단 (skip)',
      )
      return
    }

    this.isRunning = true
    let processedCount = 0
    let boostCount = 0
    let mismatchCount = 0
    let expireCount = 0
    // R2 — PG↔DB 금액 불일치 탐지 건수 (status mismatch 와 별도 집계).
    let amountMismatchCount = 0
    let errorMessage: string | null = null
    const startedAt = new Date()

    try {
      const checkpoint = await this.checkpointRepo.findSingleton()
      const since = checkpoint.lastRunAt

      this.logger.log(
        `PaymentReconciliationJob 시작 — since=${since.toISOString()}`,
      )

      // 1. PG list 조회 (정렬 created_at desc, since 이전 도달 시 break)
      let pgCheckouts: NormalizedCheckout[]
      try {
        pgCheckouts = await this.paymentGateway.listRecentCheckouts(
          since,
          PaymentReconciliationJob.POLAR_LIMIT,
        )
      } catch (e: unknown) {
        // PAY-P3-H: CircuitOpenError = polar:checkouts:list 호출점 OPEN.
        // 본 cron 회차는 skip (다음 회차 cooldown 경과 후 HALF_OPEN trial).
        // 정본: shared-contracts §27 CircuitBreakerPolicy, ADR-009.
        if (e instanceof Error && e.name === 'CircuitOpenError') {
          this.logger.warn(
            `[CircuitBreaker] PaymentReconciliationJob skip — polar:checkouts:list OPEN (${e.message})`,
          )
          errorMessage = `polar_circuit_open: ${e.message}`.slice(0, 500)
          return
        }
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.error(`Polar list API 호출 실패 — ${msg}`)
        errorMessage = `polar_list_failed: ${msg}`.slice(0, 500)
        return
      }

      // 2. 각 PG checkout 순회 — S1 boost / S2 mismatch / S4 정합 분기
      for (const pgCheckout of pgCheckouts) {
        processedCount += 1
        const dbPayment = await this.paymentRepo.findByExternalTransactionId(
          pgCheckout.externalTransactionId,
        )
        if (!dbPayment) {
          // PG에는 있는데 DB에 없는 경우 — 비정상 (Payment 생성 누락). 이후 webhook 도달 시 정상화 가능.
          this.logger.warn(
            `PG checkout 존재 + DB Payment 없음 (externalTransactionId=${pgCheckout.externalTransactionId}) — skip`,
          )
          continue
        }

        // R2 안전망: PG↔DB 금액 정합성 검사 (status 분기와 독립).
        // status 만 비교하면 R1류 이중적립(동일 status, 잔액만 2배)을 사후 탐지하지 못한다.
        // 금액 불일치 시 탐지·기록만 (자동 환수 0건 — S2 와 동일 운영자 위임 정책).
        // boost/mismatch 분기보다 먼저 검사해 매칭된 모든 row 에서 무결성 흔적을 박제.
        if (pgCheckout.amount !== dbPayment.amount) {
          await this.handleAmountMismatch(pgCheckout, dbPayment)
          amountMismatchCount += 1
          // continue 하지 않음 — 동일 row 가 status mismatch(S2)·boost(S1) 대상일 수 있어
          // 기존 status 분기도 그대로 통과시킨다 (탐지는 누적, 보정 로직은 독립).
        }

        // S1: PG=succeeded + DB=pending → boost
        if (pgCheckout.status === 'succeeded' && dbPayment.status === 'pending') {
          await this.handleBoost(dbPayment)
          boostCount += 1
          continue
        }

        // S2: PG=refunded + DB=completed → mismatch (logger.warn + AuditLog만)
        if (pgCheckout.status === 'refunded' && dbPayment.status === 'completed') {
          await this.handleRefundMismatch(dbPayment)
          mismatchCount += 1
          continue
        }

        // S4: 정합 → skip
      }

      // 3. S3: 24h 경과 pending Payment expire 처리 (PG list와 별개)
      const stalePending = await this.paymentRepo.findPendingPaymentsOlderThan(
        PaymentReconciliationJob.PENDING_EXPIRE_HOURS,
      )
      for (const payment of stalePending) {
        // 이번 cron에서 이미 boost된 row는 expire 후보에서 제외 (status가 더 이상 pending이 아님)
        // findPendingPaymentsOlderThan은 status='pending' WHERE 절로 이미 필터링됨.
        // 추가 안전망: PG에 succeeded record 존재 시 boost 우선 (S1) — 이미 위에서 처리됐을 것.
        const pgRecord = pgCheckouts.find(
          (c) => c.externalTransactionId === payment.externalTransactionId,
        )
        if (pgRecord && pgRecord.status === 'succeeded') {
          // S1에서 이미 처리됐을 가능성 — skip
          continue
        }
        await this.handleExpire(payment)
        expireCount += 1
      }

      this.logger.log(
        `PaymentReconciliationJob 완료 — processed=${processedCount} boost=${boostCount} ` +
          `mismatch=${mismatchCount} amountMismatch=${amountMismatchCount} expire=${expireCount}`,
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error(`PaymentReconciliationJob 예외 — ${msg}`)
      errorMessage = msg.slice(0, 500)
    } finally {
      // checkpoint 갱신 — 예외 발생 시에도 lastRunAt + errorMessage 박제
      try {
        await this.checkpointRepo.update({
          lastRunAt: startedAt,
          processedCount,
          boostCount,
          // R2 — 정합 이상 탐지 합산 (status refund mismatch + amount mismatch).
          // 세부 구분은 AuditLog action 으로 조회 (port 주석 참조).
          mismatchCount: mismatchCount + amountMismatchCount,
          expireCount,
          errorMessage,
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.error(`checkpoint 갱신 실패 — ${msg}`)
      }
      this.isRunning = false
    }
  }

  /**
   * S1 boost — PG=succeeded + DB=pending: webhook 누락 자동 보정.
   *
   * CC-2a (2026-05-20) — 충전 적립을 신 포인트 원장으로 이행. webhook 누락 보정도
   * `payment.usecase` 충전 success 와 동일하게 `completePaymentWithPoints` 사용
   * (단일 $transaction: Payment 완료 + deficit 우선 상계 + 충전 `CreditLedger` earn).
   * 구 `completePaymentAtomically`(`Author.credits` Int)를 쓰면 보정된 충전이 신
   * 원장에 안 박혀 CRITICAL-2 충전분이 reconciliation 경로로 새어나간다 (진단 §1-A).
   * - AuditLog operator='system_reconciliation' action='reconciliation_boost'
   */
  private async handleBoost(payment: PaymentRecord): Promise<void> {
    try {
      // [CC-4 Phase 2 rename] payment.points = 충전 총 pt (구 컬럼명 credits)
      const { settledDeficit, chargedPoints } =
        await this.paymentRepo.completePaymentWithPoints(
          payment.id,
          payment.authorId,
          payment.points,
          payment.productId,
          payment.id,
        )
      await this.auditLog.log(
        PaymentReconciliationJob.RECONCILIATION_OPERATOR,
        'reconciliation_boost',
        payment.id,
        {
          reason: 'webhook_missed',
          polarStatus: 'succeeded',
          dbStatus: 'pending',
          totalPoints: payment.points,
          chargedPoints,
          settledDeficit,
          authorId: payment.authorId,
        },
      )
      this.logger.log(
        `[boost] paymentId=${payment.id} totalPoints=${payment.points} ` +
          `charged=${chargedPoints} settledDeficit=${settledDeficit} authorId=${payment.authorId}`,
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error(`[boost] paymentId=${payment.id} 실패 — ${msg}`)
      // 본 row는 실패로 박제 — 다음 cron에서 재시도. 다른 row 처리는 계속.
      throw e
    }
  }

  /**
   * S2 refund mismatch — PG=refunded + DB=completed: 환수 필요 (P1-1 위임).
   * - 본 cron은 logger.warn + AuditLog만 (실제 환수 0건)
   * - AuditLog operator='system_reconciliation' action='reconciliation_refund_mismatch'
   */
  private async handleRefundMismatch(payment: PaymentRecord): Promise<void> {
    this.logger.warn(
      `[refund_mismatch] paymentId=${payment.id} authorId=${payment.authorId} — PG=refunded DB=completed (수동 환수 필요, P1-1)`,
    )
    await this.auditLog.log(
      PaymentReconciliationJob.RECONCILIATION_OPERATOR,
      'reconciliation_refund_mismatch',
      payment.id,
      {
        reason: 'pg_refunded_db_completed',
        polarStatus: 'refunded',
        dbStatus: 'completed',
        requiresManualRefund: true,
        authorId: payment.authorId,
        // [CC-4 Phase 2 rename] audit meta 키도 points 로 통일 (운영 모니터링 정합)
        points: payment.points,
      },
    )
  }

  /**
   * R2 amount mismatch — PG↔DB 금액 불일치: 데이터 무결성 이상 (탐지·기록만).
   *
   * R1류 이중적립(동일 status, 잔액만 2배)이나 PG/DB 금액 괴리를 운영자가 사후 인지하도록
   * AuditLog 에 박제한다. S2 refund mismatch 와 동일한 "기록 후 운영자 위임" 정책 —
   * 자동 환수/보정은 하지 않는다 (오탐 시 잘못된 환수를 막기 위함).
   * - AuditLog operator='system_reconciliation' action='reconciliation_amount_mismatch'
   */
  private async handleAmountMismatch(
    pgCheckout: NormalizedCheckout,
    payment: PaymentRecord,
  ): Promise<void> {
    this.logger.warn(
      `[amount_mismatch] paymentId=${payment.id} authorId=${payment.authorId} ` +
        `pgAmount=${pgCheckout.amount} dbAmount=${payment.amount} ` +
        `pgStatus=${pgCheckout.status} dbStatus=${payment.status} — 데이터 무결성 점검 필요 (R2)`,
    )
    await this.auditLog.log(
      PaymentReconciliationJob.RECONCILIATION_OPERATOR,
      'reconciliation_amount_mismatch',
      payment.id,
      {
        reason: 'pg_db_amount_mismatch',
        pgAmount: pgCheckout.amount,
        dbAmount: payment.amount,
        pgStatus: pgCheckout.status,
        dbStatus: payment.status,
        requiresManualReview: true,
        authorId: payment.authorId,
      },
    )
  }

  /**
   * S3 expire — PG=NotFound + DB=pending(24h 경과): 만료 처리.
   * - expirePayment (status='expired', 크레딧 변동 0)
   * - AuditLog operator='system_reconciliation' action='reconciliation_expire'
   */
  private async handleExpire(payment: PaymentRecord): Promise<void> {
    await this.paymentRepo.expirePayment(payment.id)
    await this.auditLog.log(
      PaymentReconciliationJob.RECONCILIATION_OPERATOR,
      'reconciliation_expire',
      payment.id,
      {
        reason: 'pending_24h_no_pg_record',
        dbStatusBefore: 'pending',
        dbStatusAfter: 'expired',
        authorId: payment.authorId,
      },
    )
    this.logger.log(
      `[expire] paymentId=${payment.id} authorId=${payment.authorId} — pending 24h 경과 만료 처리`,
    )
  }
}
