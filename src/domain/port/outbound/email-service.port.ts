/**
 * 이메일 서비스 포트 — provider 무관 캡슐화 (Hexagonal).
 *
 * 정본: `research/EMAIL_INTEGRITY_PLAN.md` §12 EmailServicePort.
 *
 * Provider 매트릭스 (사용자 절대 규정 0-1 결정 게이트):
 * - NullEmailAdapter (default) — 외부 API 0건, logger.warn만, isEnabled()=false
 * - ResendEmailAdapter (사용자 결정 후) — Resend SDK
 * - SesEmailAdapter (사용자 결정 후) — AWS SDK (@aws-sdk/client-ses)
 * - SendgridEmailAdapter / PostmarkEmailAdapter (보류)
 *
 * env `EMAIL_PROVIDER=null|resend|ses` 분기 → app.module DI factory.
 * UseCase는 본 인터페이스만 의존 — provider 변경 시 UseCase 코드 변경 0건.
 */

export type EmailProvider = 'null' | 'resend' | 'ses' | 'sendgrid' | 'postmark'

export type PaymentNotificationType = 'payment_success' | 'payment_failed' | 'payment_refunded'

export interface EmailSendResult {
  /** Provider가 발급한 메시지 ID (Null이면 null) */
  messageId: string | null
  /** 발송 시도한 provider 식별자 */
  provider: EmailProvider
}

export interface EmailServicePort {
  /**
   * 이메일 인증 토큰 발송 (가입 / 이메일 변경 시).
   *
   * EMAIL-P1-1 진입 후 호출 — `EmailVerificationUseCase.request` 흐름.
   */
  sendVerificationEmail(input: {
    to: string
    token: string
    displayName?: string
    expireAt: Date
  }): Promise<EmailSendResult>

  /**
   * 비밀번호 초기화 토큰 발송.
   *
   * EMAIL-P1-1 진입 후 호출 — `PasswordResetUseCase.request` 흐름.
   */
  sendPasswordResetEmail(input: {
    to: string
    token: string
    displayName?: string
    expireAt: Date
  }): Promise<EmailSendResult>

  /**
   * 결제 알림 (성공 / 실패 / 환불) — PAY-P1-2 (EMAIL-P1-3 흡수).
   *
   * payload는 type별 고정 키:
   * - payment_success: { paymentId, amount, credits, productName }
   * - payment_failed: { paymentId, amount, productName, retryUrl? }
   * - payment_refunded: { paymentId, refundedAmount, credits, deficitCredits, reason }
   */
  sendPaymentNotification(input: {
    to: string
    type: PaymentNotificationType
    displayName?: string
    payload: Record<string, unknown>
  }): Promise<EmailSendResult>

  /** Provider 활성화 여부 (env 미박제 시 false → NullAdapter) */
  isEnabled(): boolean

  /** Provider 식별자 (로그 / 감사용) */
  getProviderName(): EmailProvider
}
