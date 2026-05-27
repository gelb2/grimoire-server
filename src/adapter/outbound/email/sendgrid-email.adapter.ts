import { Injectable, Logger } from '@nestjs/common'
// @sendgrid/mail은 CommonJS `export = MailService` 패턴 — require로 import.
// 사용자 절대 규정 0-1 정합: EMAIL_PROVIDER=sendgrid 명시 분기에서만 instantiate.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sgMail = require('@sendgrid/mail')
import {
  EmailProvider,
  EmailSendResult,
  EmailServicePort,
  PaymentNotificationType,
} from '@domain/port/outbound/email-service.port'

/**
 * SendgridEmailAdapter — SendGrid 외부 SaaS 어댑터 (사용자 절대 규정 0-1 해제 후 활성).
 *
 * 정본: `.claude/state/sprint-email-polar-ready-plan-draft.md` §4-2 + §6 / `research/EMAIL_INTEGRITY_PLAN.md` §12-3.
 *
 * 활성 조건 (사용자 라이브 액션 — 모두 충족 시):
 * 1. 사용자 절대 규정 0-1 해제 명시 (G-Email-1)
 * 2. cost-accountant SaaS 단가 비교 PASS (G-Email-2)
 * 3. SaaS API key 발급 (G-Email-3)
 * 4. Cloud Run env `EMAIL_PROVIDER=sendgrid` 갱신 + `SENDGRID_API_KEY=<실값>` (G-Email-4)
 *
 * env 미설정 시 (default):
 * - app.module factory(`EMAIL_PROVIDER=null`)가 NullEmailAdapter 반환 — 본 어댑터 인스턴스 0건
 * - `SENDGRID_API_KEY` placeholder 시 isEnabled()=false 폴백
 *
 * 사용자 절대 규정 0-1 정합:
 * - 본 어댑터는 `EMAIL_PROVIDER=sendgrid` 명시 분기에서만 instantiate
 * - `SENDGRID_API_KEY` placeholder 시 sendXxx 호출 시도해도 logger.error + throw 폴백 (외부 호출 0)
 */
@Injectable()
export class SendgridEmailAdapter implements EmailServicePort {
  private readonly logger = new Logger(SendgridEmailAdapter.name)
  private static readonly PROVIDER: EmailProvider = 'sendgrid'
  private readonly fromAddress: string
  private readonly enabled: boolean

  constructor() {
    const apiKey = process.env.SENDGRID_API_KEY ?? ''
    this.fromAddress =
      process.env.EMAIL_FROM_ADDRESS ?? 'noreply@grimoire-book.com'
    if (apiKey && apiKey !== 'placeholder') {
      sgMail.setApiKey(apiKey)
      this.enabled = true
    } else {
      this.enabled = false
      this.logger.warn(
        '[SendgridEmailAdapter] SENDGRID_API_KEY 미설정 또는 placeholder — 외부 호출 차단 (isEnabled=false)',
      )
    }
  }

  async sendVerificationEmail(input: {
    to: string
    token: string
    displayName?: string
    expireAt: Date
  }): Promise<EmailSendResult> {
    if (!this.enabled) {
      throw new Error('SendgridEmailAdapter: API key 미설정 — 외부 호출 차단')
    }
    const subject = '[Grimoire] 이메일 인증을 완료해주세요'
    const html = this.renderVerificationHtml(input)
    try {
      const [response] = await sgMail.send({
        to: input.to,
        from: this.fromAddress,
        subject,
        html,
      })
      const messageId = (response.headers['x-message-id'] as string) ?? null
      return { messageId, provider: SendgridEmailAdapter.PROVIDER }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      this.logger.error(`[SendgridEmailAdapter] sendVerificationEmail 실패 — ${message}`)
      throw new Error(`SendGrid 발송 실패: ${message}`)
    }
  }

  async sendPasswordResetEmail(input: {
    to: string
    token: string
    displayName?: string
    expireAt: Date
  }): Promise<EmailSendResult> {
    if (!this.enabled) {
      throw new Error('SendgridEmailAdapter: API key 미설정 — 외부 호출 차단')
    }
    const subject = '[Grimoire] 비밀번호 초기화 요청'
    const html = this.renderPasswordResetHtml(input)
    try {
      const [response] = await sgMail.send({
        to: input.to,
        from: this.fromAddress,
        subject,
        html,
      })
      const messageId = (response.headers['x-message-id'] as string) ?? null
      return { messageId, provider: SendgridEmailAdapter.PROVIDER }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      this.logger.error(`[SendgridEmailAdapter] sendPasswordResetEmail 실패 — ${message}`)
      throw new Error(`SendGrid 발송 실패: ${message}`)
    }
  }

  async sendPaymentNotification(input: {
    to: string
    type: PaymentNotificationType
    displayName?: string
    payload: Record<string, unknown>
  }): Promise<EmailSendResult> {
    if (!this.enabled) {
      throw new Error('SendgridEmailAdapter: API key 미설정 — 외부 호출 차단')
    }
    const subject = this.renderPaymentSubject(input.type)
    const html = this.renderPaymentHtml(input)
    try {
      const [response] = await sgMail.send({
        to: input.to,
        from: this.fromAddress,
        subject,
        html,
      })
      const messageId = (response.headers['x-message-id'] as string) ?? null
      return { messageId, provider: SendgridEmailAdapter.PROVIDER }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      this.logger.error(
        `[SendgridEmailAdapter] sendPaymentNotification 실패 (type=${input.type}) — ${message}`,
      )
      throw new Error(`SendGrid 발송 실패: ${message}`)
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  getProviderName(): EmailProvider {
    return SendgridEmailAdapter.PROVIDER
  }

  private renderVerificationHtml(input: {
    to: string
    token: string
    displayName?: string
    expireAt: Date
  }): string {
    const displayName = input.displayName ?? '작가님'
    const expireText = input.expireAt.toISOString().replace('T', ' ').slice(0, 16)
    return `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fafafa;color:#222;">
  <h1 style="font-size:20px;margin:0 0 16px;color:#111;">Grimoire 이메일 인증</h1>
  <p>${this.escapeHtml(displayName)}, 안녕하세요.</p>
  <p>아래 코드를 이메일 인증 페이지에 입력해주세요.</p>
  <div style="margin:24px 0;padding:16px;background:#fff;border:1px solid #ddd;border-radius:6px;text-align:center;font-size:18px;letter-spacing:2px;word-break:break-all;">
    ${this.escapeHtml(input.token)}
  </div>
  <p style="font-size:12px;color:#666;">만료 시각: ${this.escapeHtml(expireText)} (UTC)</p>
</div>
`.trim()
  }

  private renderPasswordResetHtml(input: {
    to: string
    token: string
    displayName?: string
    expireAt: Date
  }): string {
    const displayName = input.displayName ?? '작가님'
    const expireText = input.expireAt.toISOString().replace('T', ' ').slice(0, 16)
    return `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fafafa;color:#222;">
  <h1 style="font-size:20px;margin:0 0 16px;color:#111;">Grimoire 비밀번호 초기화</h1>
  <p>${this.escapeHtml(displayName)}, 안녕하세요.</p>
  <p>아래 코드를 비밀번호 초기화 페이지에 입력해주세요.</p>
  <div style="margin:24px 0;padding:16px;background:#fff;border:1px solid #ddd;border-radius:6px;text-align:center;font-size:18px;letter-spacing:2px;word-break:break-all;">
    ${this.escapeHtml(input.token)}
  </div>
  <p style="font-size:12px;color:#666;">만료 시각: ${this.escapeHtml(expireText)} (UTC)</p>
</div>
`.trim()
  }

  private renderPaymentSubject(type: PaymentNotificationType): string {
    switch (type) {
      case 'payment_success':
        return '[Grimoire] 결제가 완료되었습니다'
      case 'payment_failed':
        return '[Grimoire] 결제가 실패했습니다'
      case 'payment_refunded':
        return '[Grimoire] 환불이 처리되었습니다'
    }
  }

  private renderPaymentHtml(input: {
    to: string
    type: PaymentNotificationType
    displayName?: string
    payload: Record<string, unknown>
  }): string {
    const displayName = input.displayName ?? '작가님'
    const rows = Object.entries(input.payload)
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 8px;color:#666;">${this.escapeHtml(k)}</td><td style="padding:6px 8px;color:#111;">${this.escapeHtml(String(v))}</td></tr>`,
      )
      .join('')
    return `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fafafa;color:#222;">
  <h1 style="font-size:20px;margin:0 0 16px;color:#111;">${this.escapeHtml(this.renderPaymentSubject(input.type))}</h1>
  <p>${this.escapeHtml(displayName)}, 안녕하세요.</p>
  <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #ddd;border-radius:6px;margin:16px 0;">
    ${rows}
  </table>
</div>
`.trim()
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
