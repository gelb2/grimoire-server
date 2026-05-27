import { Logger } from '@nestjs/common'
import { EmailServicePort } from '@domain/port/outbound/email-service.port'
import { NullEmailAdapter } from '@adapter/outbound/email/null-email.adapter'
import { ResendEmailAdapter } from '@adapter/outbound/email/resend-email.adapter'
import { SendgridEmailAdapter } from '@adapter/outbound/email/sendgrid-email.adapter'

/**
 * EmailService Factory — env `EMAIL_PROVIDER` 분기.
 *
 * 정본: `.claude/state/sprint-email-polar-ready-plan-draft.md` §4-2 + §6
 *
 * 사용자 절대 규정 0-1 정합:
 * - default(`null` 또는 미설정): NullEmailAdapter — 외부 호출 0건
 * - `resend`: ResendEmailAdapter — RESEND_API_KEY 실값 필요 (placeholder 시 isEnabled=false)
 * - `sendgrid`: SendgridEmailAdapter — SENDGRID_API_KEY 실값 필요
 * - 미지원(`ses`/`postmark` 등): NullEmailAdapter 폴백 + logger.warn
 *
 * 사용자 라이브 액션 (Polar KYC + Email SaaS 게이트 통과 후):
 *   `gcloud run services update grimoire-server-prod --update-env-vars EMAIL_PROVIDER=resend`
 */
export function createEmailService(): EmailServicePort {
  const logger = new Logger('EmailServiceFactory')
  const provider = (process.env.EMAIL_PROVIDER ?? 'null').toLowerCase()

  switch (provider) {
    case 'resend':
      logger.log('[EmailServiceFactory] ResendEmailAdapter 활성')
      return new ResendEmailAdapter()
    case 'sendgrid':
      logger.log('[EmailServiceFactory] SendgridEmailAdapter 활성')
      return new SendgridEmailAdapter()
    case 'null':
    case '':
      return new NullEmailAdapter()
    default:
      logger.warn(
        `[EmailServiceFactory] 미지원 provider="${provider}" — NullEmailAdapter 폴백`,
      )
      return new NullEmailAdapter()
  }
}
