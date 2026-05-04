import { Injectable, Logger } from '@nestjs/common'
import {
  EmailProvider,
  EmailSendResult,
  EmailServicePort,
  PaymentNotificationType,
} from '@domain/port/outbound/email-service.port'

/**
 * NullEmailAdapter — 외부 API 신규 의존 0건 default 어댑터.
 *
 * 정본: `research/EMAIL_INTEGRITY_PLAN.md` §12-3 어댑터 매트릭스.
 *
 * 동작:
 * - 실제 발송 0건 (외부 API 호출 0)
 * - logger.warn 박제 (수신자 + 토큰 일부 마스킹)
 * - messageId=null + provider='null' 반환
 * - isEnabled()=false (UseCase 측에서 fallback 또는 skip 결정 가능)
 *
 * 사용 케이스:
 * - 사용자 절대 규정 0-1 (외부 Anthropic API 신규 의존 영구 보류) 영역과 동일 정책 적용 시 default
 * - dev / e2e 환경에서 실제 발송 차단
 * - 사용자가 ResendAdapter / SesAdapter 결정 전까지 기본
 */
@Injectable()
export class NullEmailAdapter implements EmailServicePort {
  private readonly logger = new Logger(NullEmailAdapter.name)
  private static readonly PROVIDER: EmailProvider = 'null'

  async sendVerificationEmail(input: {
    to: string
    token: string
    displayName?: string
    expireAt: Date
  }): Promise<EmailSendResult> {
    this.logger.warn(
      `[NullEmailAdapter] sendVerificationEmail skipped — to=${this.maskEmail(input.to)} token=${this.maskToken(input.token)} expireAt=${input.expireAt.toISOString()}`,
    )
    return { messageId: null, provider: NullEmailAdapter.PROVIDER }
  }

  async sendPasswordResetEmail(input: {
    to: string
    token: string
    displayName?: string
    expireAt: Date
  }): Promise<EmailSendResult> {
    this.logger.warn(
      `[NullEmailAdapter] sendPasswordResetEmail skipped — to=${this.maskEmail(input.to)} token=${this.maskToken(input.token)} expireAt=${input.expireAt.toISOString()}`,
    )
    return { messageId: null, provider: NullEmailAdapter.PROVIDER }
  }

  async sendPaymentNotification(input: {
    to: string
    type: PaymentNotificationType
    displayName?: string
    payload: Record<string, unknown>
  }): Promise<EmailSendResult> {
    this.logger.warn(
      `[NullEmailAdapter] sendPaymentNotification skipped — to=${this.maskEmail(input.to)} type=${input.type}`,
    )
    return { messageId: null, provider: NullEmailAdapter.PROVIDER }
  }

  isEnabled(): boolean {
    return false
  }

  getProviderName(): EmailProvider {
    return NullEmailAdapter.PROVIDER
  }

  /** 이메일 PII 마스킹 — 로그에 평문 박제 차단 */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@')
    if (!local || !domain) return '***'
    const masked = local.length <= 2 ? '*'.repeat(local.length) : `${local[0]}***${local[local.length - 1]}`
    return `${masked}@${domain}`
  }

  /** 토큰 마스킹 — 처음 4자 + ***만 박제 */
  private maskToken(token: string): string {
    if (token.length <= 4) return '***'
    return `${token.slice(0, 4)}***`
  }
}
