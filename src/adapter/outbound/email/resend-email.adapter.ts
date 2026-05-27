import { Injectable, Logger } from '@nestjs/common'
import { Resend } from 'resend'
import {
  EmailProvider,
  EmailSendResult,
  EmailServicePort,
  PaymentNotificationType,
} from '@domain/port/outbound/email-service.port'

/**
 * ResendEmailAdapter — Resend 외부 SaaS 어댑터 (사용자 절대 규정 0-1 해제 후 활성).
 *
 * 정본: `.claude/state/sprint-email-polar-ready-plan-draft.md` §4-2 + §6 / `research/EMAIL_INTEGRITY_PLAN.md` §12-3.
 *
 * 활성 조건 (사용자 라이브 액션 — 모두 충족 시):
 * 1. 사용자 절대 규정 0-1 해제 명시 (G-Email-1)
 * 2. cost-accountant SaaS 단가 비교 PASS (G-Email-2)
 * 3. SaaS API key 발급 (G-Email-3)
 * 4. Cloud Run env `EMAIL_PROVIDER=resend` 갱신 + `RESEND_API_KEY=<실값>` (G-Email-4)
 *
 * env 미설정 시 (default):
 * - app.module factory(`EMAIL_PROVIDER=null`)가 NullEmailAdapter 반환 — 본 어댑터 인스턴스 0건
 * - `RESEND_API_KEY` placeholder 시 isEnabled()=false 폴백
 *
 * 사용자 절대 규정 0-1 정합:
 * - 본 어댑터는 `EMAIL_PROVIDER=resend` 명시 분기에서만 instantiate
 * - `RESEND_API_KEY` placeholder 시 sendXxx 호출 시도해도 logger.error + throw 폴백 (외부 호출 0)
 */
@Injectable()
export class ResendEmailAdapter implements EmailServicePort {
  private readonly logger = new Logger(ResendEmailAdapter.name)
  private static readonly PROVIDER: EmailProvider = 'resend'
  private readonly client: Resend | null
  private readonly fromAddress: string
  private readonly apiKey: string

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY ?? ''
    this.fromAddress =
      process.env.EMAIL_FROM_ADDRESS ?? 'noreply@grimoire-book.com'
    // API key가 placeholder/빈값 시 client null — sendXxx 시도 자체 차단
    if (this.apiKey && this.apiKey !== 'placeholder') {
      this.client = new Resend(this.apiKey)
    } else {
      this.client = null
      this.logger.warn(
        '[ResendEmailAdapter] RESEND_API_KEY 미설정 또는 placeholder — 외부 호출 차단 (isEnabled=false)',
      )
    }
  }

  async sendVerificationEmail(input: {
    to: string
    token: string
    displayName?: string
    expireAt: Date
  }): Promise<EmailSendResult> {
    if (!this.client) {
      throw new Error('ResendEmailAdapter: API key 미설정 — 외부 호출 차단')
    }
    const subject = '[Grimoire] 이메일 인증을 완료해주세요'
    const html = this.renderVerificationHtml(input)
    const result = await this.client.emails.send({
      from: this.fromAddress,
      to: input.to,
      subject,
      html,
    })
    if (result.error) {
      this.logger.error(
        `[ResendEmailAdapter] sendVerificationEmail 실패 — ${result.error.message}`,
      )
      throw new Error(`Resend 발송 실패: ${result.error.message}`)
    }
    return { messageId: result.data?.id ?? null, provider: ResendEmailAdapter.PROVIDER }
  }

  async sendPasswordResetEmail(input: {
    to: string
    token: string
    displayName?: string
    expireAt: Date
  }): Promise<EmailSendResult> {
    if (!this.client) {
      throw new Error('ResendEmailAdapter: API key 미설정 — 외부 호출 차단')
    }
    const subject = '[Grimoire] 비밀번호 초기화 요청'
    const html = this.renderPasswordResetHtml(input)
    const result = await this.client.emails.send({
      from: this.fromAddress,
      to: input.to,
      subject,
      html,
    })
    if (result.error) {
      this.logger.error(
        `[ResendEmailAdapter] sendPasswordResetEmail 실패 — ${result.error.message}`,
      )
      throw new Error(`Resend 발송 실패: ${result.error.message}`)
    }
    return { messageId: result.data?.id ?? null, provider: ResendEmailAdapter.PROVIDER }
  }

  async sendPaymentNotification(input: {
    to: string
    type: PaymentNotificationType
    displayName?: string
    payload: Record<string, unknown>
  }): Promise<EmailSendResult> {
    if (!this.client) {
      throw new Error('ResendEmailAdapter: API key 미설정 — 외부 호출 차단')
    }
    const subject = this.renderPaymentSubject(input.type)
    const html = this.renderPaymentHtml(input)
    const result = await this.client.emails.send({
      from: this.fromAddress,
      to: input.to,
      subject,
      html,
    })
    if (result.error) {
      this.logger.error(
        `[ResendEmailAdapter] sendPaymentNotification 실패 (type=${input.type}) — ${result.error.message}`,
      )
      throw new Error(`Resend 발송 실패: ${result.error.message}`)
    }
    return { messageId: result.data?.id ?? null, provider: ResendEmailAdapter.PROVIDER }
  }

  isEnabled(): boolean {
    return this.client !== null
  }

  getProviderName(): EmailProvider {
    return ResendEmailAdapter.PROVIDER
  }

  /** 이메일 인증 HTML 템플릿 (CSR/SSR 무관, 정적 인라인) */
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
  <p style="font-size:12px;color:#666;">본 메일을 요청하지 않았다면 무시하셔도 됩니다.</p>
</div>
`.trim()
  }

  /** 비밀번호 초기화 HTML 템플릿 */
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
  <p style="font-size:12px;color:#666;">본 요청을 보낸 적이 없다면 즉시 비밀번호를 변경해주세요.</p>
</div>
`.trim()
  }

  /** 결제 알림 제목 매핑 */
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

  /** 결제 알림 HTML 템플릿 (type별 payload 매핑) */
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
  <p style="font-size:12px;color:#666;">자세한 내역은 대시보드 → 결제 내역에서 확인할 수 있습니다.</p>
</div>
`.trim()
  }

  /** HTML escape — XSS 차단 */
  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
