import { Injectable, Inject, Logger, Optional } from '@nestjs/common'
import { EmailServicePort } from '@domain/port/outbound/email-service.port'
import { SmsServicePort } from '@domain/port/outbound/sms-service.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'

/**
 * PaymentNotificationUseCase — 결제 알림 발송 (EMAIL-POLAR-READY Phase D, PAY-P1-2/S4).
 *
 * 정본: `.claude/state/sprint-email-polar-ready-plan-draft.md` §8
 *
 * 결제 트랜잭션 원자성 절대 규정 (CLAUDE.md §9 + ADR-009 정합):
 * - 본 usecase는 payment.usecase의 `$transaction` 외부에서 호출됨
 * - 호출자(payment.usecase / refund-payment.usecase)는 본 메서드를 try/catch 감싸야 함
 * - 알림 실패가 결제 commit을 롤백시키지 않음 (logger.error만, throw 미발생)
 *
 * 사용자 절대 규정 0-1 정합:
 * - EmailServicePort/SmsServicePort 가 NullAdapter (default) 시 isEnabled=false → 호출 0건
 * - ResendAdapter/SendgridAdapter 활성 시에만 실 발송
 *
 * 통합 매트릭스 (호출자 → 본 메서드):
 * - payment.usecase processWebhook success → notifyChargeSuccess
 * - payment.usecase processWebhook fail → notifyChargeFailed
 * - refund-payment.usecase execute → notifyRefundProcessed
 * - process-subscription-webhook.usecase (별도 sprint) → notifySubscriptionRenewal
 */
@Injectable()
export class PaymentNotificationUseCase {
  private readonly logger = new Logger(PaymentNotificationUseCase.name)

  constructor(
    @Inject('EmailServicePort') private readonly emailService: EmailServicePort,
    @Optional()
    @Inject('SmsServicePort')
    private readonly smsService: SmsServicePort | null = null,
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
  ) {}

  /**
   * 충전 성공 알림.
   *
   * @param payment 결제 정보 (PaymentRepositoryPort.findById 결과 또는 호출자 추출본)
   * @param author Author (email/name 매핑용) — 미주입 시 authorRepo.findById 폴백
   * @returns 발송 결과 — { emailSent, smsSent, skipped, reason? }
   */
  async notifyChargeSuccess(input: {
    paymentId: string
    authorId: string
    amount: number
    credits: number
    productName?: string
  }): Promise<{ emailSent: boolean; smsSent: boolean; skipped: boolean; reason?: string }> {
    if (!this.isAnyEnabled()) {
      // NullAdapter only — 외부 호출 0건
      return { emailSent: false, smsSent: false, skipped: true, reason: 'all_adapters_disabled' }
    }
    const author = await this.fetchAuthor(input.authorId)
    if (!author) {
      this.logger.warn(
        `[PaymentNotification] notifyChargeSuccess skip — author not found (authorId=${input.authorId})`,
      )
      return { emailSent: false, smsSent: false, skipped: true, reason: 'author_not_found' }
    }
    const payload = {
      paymentId: input.paymentId,
      amount: input.amount,
      credits: input.credits,
      productName: input.productName ?? '',
    }
    return this.sendBoth(author, 'payment_success', payload)
  }

  /** 충전 실패 알림 */
  async notifyChargeFailed(input: {
    paymentId: string
    authorId: string
    amount: number
    productName?: string
  }): Promise<{ emailSent: boolean; smsSent: boolean; skipped: boolean; reason?: string }> {
    if (!this.isAnyEnabled()) {
      return { emailSent: false, smsSent: false, skipped: true, reason: 'all_adapters_disabled' }
    }
    const author = await this.fetchAuthor(input.authorId)
    if (!author) {
      return { emailSent: false, smsSent: false, skipped: true, reason: 'author_not_found' }
    }
    const payload = {
      paymentId: input.paymentId,
      amount: input.amount,
      productName: input.productName ?? '',
    }
    return this.sendBoth(author, 'payment_failed', payload)
  }

  /** 환불 완료 알림 */
  async notifyRefundProcessed(input: {
    paymentId: string
    authorId: string
    refundedAmount: number
    actualRefunded: number
    deficitIncurred: number
    isPartial: boolean
    reason: string
  }): Promise<{ emailSent: boolean; smsSent: boolean; skipped: boolean; reason?: string }> {
    if (!this.isAnyEnabled()) {
      return { emailSent: false, smsSent: false, skipped: true, reason: 'all_adapters_disabled' }
    }
    const author = await this.fetchAuthor(input.authorId)
    if (!author) {
      return { emailSent: false, smsSent: false, skipped: true, reason: 'author_not_found' }
    }
    const payload = {
      paymentId: input.paymentId,
      refundedAmount: input.refundedAmount,
      credits: input.actualRefunded,
      deficitCredits: input.deficitIncurred,
      reason: input.reason,
      isPartial: input.isPartial,
    }
    return this.sendBoth(author, 'payment_refunded', payload)
  }

  /** 구독 갱신 알림 — process-subscription-webhook 호출 영역 (Phase D-6) */
  async notifySubscriptionRenewal(input: {
    authorId: string
    tier: string
    monthlyPoolPoints: number
    expiresAt: Date | null
  }): Promise<{ emailSent: boolean; smsSent: boolean; skipped: boolean; reason?: string }> {
    if (!this.isAnyEnabled()) {
      return { emailSent: false, smsSent: false, skipped: true, reason: 'all_adapters_disabled' }
    }
    const author = await this.fetchAuthor(input.authorId)
    if (!author) {
      return { emailSent: false, smsSent: false, skipped: true, reason: 'author_not_found' }
    }
    // 구독 갱신은 payment_success 템플릿 재사용 (별도 type 추가 회피 — 본 sprint 최소 박제)
    const payload = {
      paymentId: `subscription_${input.tier}`,
      amount: 0,
      credits: input.monthlyPoolPoints,
      productName: `${input.tier.toUpperCase()} 구독`,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    }
    return this.sendBoth(author, 'payment_success', payload)
  }

  // -------------------- private --------------------

  private isAnyEnabled(): boolean {
    return this.emailService.isEnabled() || (this.smsService?.isEnabled() ?? false)
  }

  private async fetchAuthor(
    authorId: string,
  ): Promise<{ id: string; email: string; name: string } | null> {
    try {
      const author = await this.authorRepo.findById(authorId)
      if (!author) return null
      return { id: author.id, email: author.email, name: author.name }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      this.logger.warn(
        `[PaymentNotification] author 조회 실패 (authorId=${authorId}): ${message}`,
      )
      return null
    }
  }

  /** Email + SMS 양측 발송 — 각 어댑터 isEnabled 시만 호출, 실패는 logger.error만 (throw 0) */
  private async sendBoth(
    author: { id: string; email: string; name: string },
    type: 'payment_success' | 'payment_failed' | 'payment_refunded',
    payload: Record<string, unknown>,
  ): Promise<{ emailSent: boolean; smsSent: boolean; skipped: boolean }> {
    let emailSent = false
    let smsSent = false

    if (this.emailService.isEnabled()) {
      try {
        await this.emailService.sendPaymentNotification({
          to: author.email,
          type,
          displayName: author.name,
          payload,
        })
        emailSent = true
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e)
        this.logger.error(
          `[PaymentNotification] email 발송 실패 (authorId=${author.id}, type=${type}): ${message}`,
        )
      }
    }

    if (this.smsService?.isEnabled()) {
      try {
        // SMS는 전화번호가 필요하지만 Author 모델에 phone 컬럼 미존재 → 본 sprint 호출만 박제, 미동작
        // 별 sprint에서 Author.phone 컬럼 + 호출 실 활성
        this.logger.warn(
          `[PaymentNotification] SMS 어댑터 활성이나 Author.phone 컬럼 미박제 — sms 호출 skip (별 sprint 작업)`,
        )
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e)
        this.logger.error(
          `[PaymentNotification] sms 발송 실패 (authorId=${author.id}, type=${type}): ${message}`,
        )
      }
    }

    return { emailSent, smsSent, skipped: !emailSent && !smsSent }
  }
}
