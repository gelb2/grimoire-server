import { Injectable, Inject, BadRequestException, Logger, Optional } from '@nestjs/common'
import { PaymentRepositoryPort } from '@domain/port/outbound/payment-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditLedgerPort } from '@domain/port/outbound/credit-ledger.port'
import { AuditLogService } from '@application/admin/audit-log.service'

/**
 * 환불 처리 UseCase — CC-2b (2026-05-20) 신 경로 + 이중 외상 통합.
 *
 * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §1-C
 *       .claude/state/sprint-cc2b-gift-refund-wiring-plan-draft.md §5
 *       .claude/shared-contracts.md §13 + §30
 *
 * Polar 환불 webhook 수신 시 payment.usecase.processWebhook 의 'cancel' 분기에서 호출.
 * CC-2b 이전: `refundPaymentAtomically` (구 `Author.credits` Int + `CreditLog`).
 * CC-2b 이후: `refundPaymentWithPoints` (4 출처 환수 + 이중 외상 통합).
 *
 * 분기 (이중 외상 통합):
 * - 정상 환수 (4 출처 합 ≥ proportionalPt): action='refund_normal', deficitIncurred=0
 * - deficit 환수 (4 출처 합 < proportionalPt): action='refund_deficit',
 *   부족분 → `Author.deficitPoints` 가산 → 다음 충전 시 CC-2a 가 자동 회수.
 *
 * 멱등성 (3중 게이트 보존):
 * - L1 webhook event_id (PAY-P0-1, payment.usecase 진입부 처리)
 * - L2 payment.status='completed' 사전 체크 (이미 환불된 payment 는 BadRequest)
 * - L3 RefundLog 박제 (운영자 조회 + 추적용)
 */
@Injectable()
export class RefundPaymentUseCase {
  private readonly logger = new Logger(RefundPaymentUseCase.name)

  constructor(
    @Inject('PaymentRepositoryPort') private readonly paymentRepo: PaymentRepositoryPort,
    private readonly auditLogService: AuditLogService,
    /**
     * PAY-P2-4 — 잔액 사전 조회 (beforeState 박제용).
     * Optional이지만 실 운영(`app.module.ts`)에서는 항상 주입됨.
     * 미주입 시 beforeState 박제 skip (BACKWARD COMPATIBLE).
     */
    @Optional()
    @Inject('AuthorRepositoryPort')
    private readonly authorRepo: AuthorRepositoryPort | null = null,
    /**
     * CC-2b — 4 출처 잔액 조회용 (beforeState 박제 디노미 정합).
     * Optional — 미주입 시 4 출처 분해 skip, balanceBefore 만 박제.
     */
    @Optional()
    @Inject('CreditLedgerPort')
    private readonly ledger: CreditLedgerPort | null = null,
  ) {}

  /**
   * @param input.paymentId 환불 대상 Payment id (이미 completed 상태여야 함)
   * @param input.authorId 환수 대상 Author id
   * @param input.refundPt 환수할 포인트 (양수 — `Payment.points` pt 단위, CC-4 Phase 2 rename 완료)
   * @param input.refundedAmount PG 환불 금액 (KRW)
   * @param input.reason 환불 사유 (예: 'polar_webhook_order.refunded')
   * @param input.source 'webhook' (Polar 자동) | 'manual' (운영자 수동, P2)
   * @returns actualRefunded (실 환수 pt), deficitIncurred (외상 발생 pt), proportionalPt, isPartial
   */
  async execute(input: {
    paymentId: string
    authorId: string
    refundPt: number
    refundedAmount: number
    reason: string
    source: 'webhook' | 'manual'
  }): Promise<{
    actualRefunded: number
    deficitIncurred: number
    proportionalPt: number
    isPartial: boolean
  }> {
    const { paymentId, authorId, refundPt, refundedAmount, reason, source } = input

    if (refundPt < 0) {
      throw new BadRequestException(`환불 포인트는 음수일 수 없습니다: ${refundPt}`)
    }
    if (refundedAmount <= 0) {
      throw new BadRequestException(`환불 금액은 양수여야 합니다: ${refundedAmount}`)
    }

    // L2 게이트 — payment 사전 검증은 호출자(payment.usecase)가 수행 (status='completed' 검증 후 본 usecase 호출).
    // PAY-P2-1: $transaction 내부에서 payment.amount 조회 + refundedAmount > payment.amount 시 throw.
    // 본 usecase는 그 throw를 catch → 호출자(payment.usecase)에 위임 → webhook event 'failed' 박제.

    // CC-2b: 잔액 사전 조회 — ledger.getBalance(4 출처) 우선, fallback authorRepo (pointsCharged 단일)
    // beforeState 박제는 4 출처 디노미 정합 — CC-2a auditLog 패턴과 일관
    let balanceBefore: {
      free: number
      subscription: number
      gift: number
      charged: number
      total: number
      deficit: number
    } | null = null
    if (this.ledger) {
      try {
        const b = await this.ledger.getBalance(authorId)
        balanceBefore = {
          free: b.free,
          subscription: b.subscription,
          gift: b.gift,
          charged: b.charged,
          total: b.total,
          deficit: b.deficit,
        }
      } catch (e: unknown) {
        this.logger.warn(
          `잔액 사전 조회 실패 (authorId=${authorId}, paymentId=${paymentId}): ${
            e instanceof Error ? e.message : String(e)
          }`,
        )
      }
    } else if (this.authorRepo) {
      // fallback — ledger 미주입 시 author 캐시 pointsCharged 만 박제(회귀 보존)
      try {
        const author = await this.authorRepo.findById(authorId)
        if (author) {
          balanceBefore = {
            free: 0,
            subscription: 0,
            gift: 0,
            charged: author.credits ?? 0,
            total: author.credits ?? 0,
            deficit: 0,
          }
        }
      } catch (e: unknown) {
        this.logger.warn(
          `잔액 사전 조회 실패 (authorId=${authorId}, paymentId=${paymentId}): ${
            e instanceof Error ? e.message : String(e)
          }`,
        )
      }
    }

    // 환수 트랜잭션 실행 — CC-2b 신 경로 (4 출처 환수 + 이중 외상 통합)
    let result: {
      actualRefunded: number
      deficitIncurred: number
      proportionalPt: number
      isPartial: boolean
    }
    try {
      result = await this.paymentRepo.refundPaymentWithPoints({
        paymentId,
        authorId,
        refundPt,
        refundedAmount,
        reason,
        source,
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      this.logger.error(
        `환불 트랜잭션 실패 (paymentId=${paymentId}, authorId=${authorId}, refundPt=${refundPt}, refundedAmount=${refundedAmount}): ${message}`,
      )
      throw e
    }

    const { actualRefunded, deficitIncurred, proportionalPt, isPartial } = result

    // AdminAuditLog 후행 (트랜잭션 외 — DB commit 후 박제)
    const action = isPartial
      ? deficitIncurred > 0
        ? 'refund_partial_deficit'
        : 'refund_partial'
      : deficitIncurred > 0
        ? 'refund_deficit'
        : 'refund_normal'

    const paymentStatusAfter = isPartial ? 'partial_refunded' : 'refunded'

    try {
      await this.auditLogService.log(
        'system_refund',
        action,
        paymentId,
        {
          authorId,
          refundedAmount,
          refundPtRequested: refundPt,
          proportionalPt,
          actualRefunded,
          deficitIncurred,
          isPartial,
          reason,
          source,
        },
        balanceBefore !== null
          ? { ...balanceBefore, paymentStatus: 'completed' }
          : undefined,
        balanceBefore !== null
          ? {
              // 환수액은 충전 우선 환수(charged → gift → subscription → free) 정책 —
              // 정밀 분해는 ledger row 가 정본, 본 afterState 는 총량 기준 박제
              total: Math.max(0, balanceBefore.total - actualRefunded),
              deficit: balanceBefore.deficit + deficitIncurred,
              paymentStatus: paymentStatusAfter,
              actualRefunded,
              deficitIncurred,
            }
          : undefined,
      )
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      this.logger.warn(
        `AuditLog 박제 실패 (환수는 성공, paymentId=${paymentId}): ${message}`,
      )
    }

    if (isPartial) {
      this.logger.log(
        `부분 환불 (paymentId=${paymentId}, authorId=${authorId}, refundedAmount=${refundedAmount}, proportionalPt=${proportionalPt}, recovered=${actualRefunded})`,
      )
    }
    if (deficitIncurred > 0) {
      this.logger.warn(
        `환불 deficit 발생 (paymentId=${paymentId}, authorId=${authorId}, proportionalPt=${proportionalPt}, recovered=${actualRefunded}, deficit=${deficitIncurred}) — Author.deficitPoints 가산, 다음 충전 시 자동 회수`,
      )
    }

    return { actualRefunded, deficitIncurred, proportionalPt, isPartial }
  }
}
