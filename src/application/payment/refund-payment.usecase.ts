import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common'
import { PaymentRepositoryPort } from '@domain/port/outbound/payment-repository.port'
import { AuditLogService } from '@application/admin/audit-log.service'

/**
 * 환불 처리 UseCase (Sprint PAY-P1-1, 2026-05-03)
 *
 * Polar 환불 webhook 수신 시 payment.usecase.processWebhook의 'cancel' 분기에서 호출.
 * 크레딧 환수 트랜잭션 + RefundLog 박제 + AdminAuditLog(operator='system_refund') 후행.
 *
 * 분기:
 * - 정상 환수 (Author.credits >= credits): action='refund_normal', deficitCredits=0
 * - deficit 환수 (Author.credits < credits): action='refund_deficit', deficitCredits>0 (운영자 회수 정책)
 *
 * 멱등성 (3중 게이트):
 * - L1 webhook event_id (PAY-P0-1, payment.usecase 진입부 처리)
 * - L2 payment.status='completed' 사전 체크 (이미 환불된 payment는 BadRequest)
 * - L3 RefundLog 박제 (운영자 조회 + 추적용)
 *
 * 정본: `.claude/shared-contracts.md` §13 RefundPaymentAtomically
 */
@Injectable()
export class RefundPaymentUseCase {
  private readonly logger = new Logger(RefundPaymentUseCase.name)

  constructor(
    @Inject('PaymentRepositoryPort') private readonly paymentRepo: PaymentRepositoryPort,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * @param input.paymentId 환불 대상 Payment id (이미 completed 상태여야 함)
   * @param input.authorId 환수 대상 Author id
   * @param input.credits 환수할 크레딧 (양수 입력 — 내부에서 음수 변환)
   * @param input.refundedAmount PG 환불 금액 (KRW)
   * @param input.reason 환불 사유 (예: 'polar_webhook_order.refunded')
   * @param input.source 'webhook' (Polar 자동) | 'manual' (운영자 수동, P2)
   * @returns actualDeducted (실제 차감 크레딧 — deficit 시 잔액), deficitCredits (잔액 부족분)
   */
  async execute(input: {
    paymentId: string
    authorId: string
    credits: number
    refundedAmount: number
    reason: string
    source: 'webhook' | 'manual'
  }): Promise<{
    actualDeducted: number
    deficitCredits: number
    proportionalCredits: number
    isPartial: boolean
  }> {
    const { paymentId, authorId, credits, refundedAmount, reason, source } = input

    if (credits < 0) {
      throw new BadRequestException(`환불 크레딧은 음수일 수 없습니다: ${credits}`)
    }
    if (refundedAmount <= 0) {
      throw new BadRequestException(`환불 금액은 양수여야 합니다: ${refundedAmount}`)
    }

    // L2 게이트 — payment 사전 검증은 호출자(payment.usecase)가 수행 (status='completed' 검증 후 본 usecase 호출).
    // PAY-P2-1: $transaction 내부에서 payment.amount 조회 + refundedAmount > payment.amount 시 throw.
    // 본 usecase는 그 throw를 catch → 호출자(payment.usecase)에 위임 → webhook event 'failed' 박제.

    // 환수 트랜잭션 실행 ($transaction 내부에서 비율 계산 + Payment.status 갱신 — race 차단)
    let result: {
      actualDeducted: number
      deficitCredits: number
      proportionalCredits: number
      isPartial: boolean
    }
    try {
      result = await this.paymentRepo.refundPaymentAtomically({
        paymentId,
        authorId,
        credits,
        refundedAmount,
        reason,
        source,
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      this.logger.error(
        `환불 트랜잭션 실패 (paymentId=${paymentId}, authorId=${authorId}, credits=${credits}, refundedAmount=${refundedAmount}): ${message}`,
      )
      // payment 미존재 / refundedAmount > payment.amount / 이미 갱신된 row / DB 장애 등
      // 호출자(payment.usecase)에 throw 위임 → webhook event 'failed' 박제
      throw e
    }

    const { actualDeducted, deficitCredits, proportionalCredits, isPartial } = result

    // AdminAuditLog 후행 (트랜잭션 외 — DB commit 후 박제. 실패 시 logger.error만, throw 0)
    // action 분기 (PAY-P2-1):
    //   - 부분 환불 + deficit: 'refund_partial_deficit'
    //   - 부분 환불 정상: 'refund_partial'
    //   - 전액 환불 + deficit: 'refund_deficit' (PAY-P1-1 회귀 보존)
    //   - 전액 환불 정상: 'refund_normal' (PAY-P1-1 회귀 보존)
    const action = isPartial
      ? deficitCredits > 0
        ? 'refund_partial_deficit'
        : 'refund_partial'
      : deficitCredits > 0
        ? 'refund_deficit'
        : 'refund_normal'

    try {
      await this.auditLogService.log('system_refund', action, paymentId, {
        authorId,
        refundedAmount,
        creditsRequested: credits,
        proportionalCredits,
        creditsActuallyDeducted: actualDeducted,
        deficitCredits,
        isPartial,
        reason,
        source,
      })
    } catch (e: unknown) {
      // AuditLog 실패는 환수 트랜잭션 결과를 무효화하지 않음 — logger 경고만
      const message = e instanceof Error ? e.message : String(e)
      this.logger.warn(
        `AuditLog 박제 실패 (환수는 성공, paymentId=${paymentId}): ${message}`,
      )
    }

    if (isPartial) {
      this.logger.log(
        `부분 환불 (paymentId=${paymentId}, authorId=${authorId}, refundedAmount=${refundedAmount}, proportionalCredits=${proportionalCredits}, deducted=${actualDeducted})`,
      )
    }
    if (deficitCredits > 0) {
      this.logger.warn(
        `환불 deficit 발생 (paymentId=${paymentId}, authorId=${authorId}, proportionalCredits=${proportionalCredits}, deducted=${actualDeducted}, deficit=${deficitCredits})`,
      )
    }

    return { actualDeducted, deficitCredits, proportionalCredits, isPartial }
  }
}
