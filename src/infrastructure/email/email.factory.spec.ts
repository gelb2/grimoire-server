import { createEmailService } from './email.factory'
import { NullEmailAdapter } from '@adapter/outbound/email/null-email.adapter'
import { ResendEmailAdapter } from '@adapter/outbound/email/resend-email.adapter'
import { SendgridEmailAdapter } from '@adapter/outbound/email/sendgrid-email.adapter'

/**
 * createEmailService factory — env `EMAIL_PROVIDER` 분기 spec.
 *
 * 사용자 절대 규정 0-1 정합 — default 시 NullEmailAdapter 반환 강제.
 */
describe('createEmailService — EMAIL_PROVIDER 분기', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    // 각 테스트 후 env 원복
    process.env = { ...originalEnv }
  })

  it('EMAIL_PROVIDER 미설정 시 NullEmailAdapter 반환 (default)', () => {
    delete process.env.EMAIL_PROVIDER
    const service = createEmailService()
    expect(service).toBeInstanceOf(NullEmailAdapter)
    expect(service.isEnabled()).toBe(false)
    expect(service.getProviderName()).toBe('null')
  })

  it('EMAIL_PROVIDER=null 명시 시 NullEmailAdapter 반환', () => {
    process.env.EMAIL_PROVIDER = 'null'
    const service = createEmailService()
    expect(service).toBeInstanceOf(NullEmailAdapter)
    expect(service.getProviderName()).toBe('null')
  })

  it('EMAIL_PROVIDER=resend + RESEND_API_KEY 미설정 시 ResendEmailAdapter 인스턴스(isEnabled=false 폴백)', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    delete process.env.RESEND_API_KEY
    const service = createEmailService()
    expect(service).toBeInstanceOf(ResendEmailAdapter)
    expect(service.isEnabled()).toBe(false)
    expect(service.getProviderName()).toBe('resend')
  })

  it('EMAIL_PROVIDER=resend + RESEND_API_KEY=placeholder 시 isEnabled=false', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 'placeholder'
    const service = createEmailService()
    expect(service.isEnabled()).toBe(false)
  })

  it('EMAIL_PROVIDER=resend + RESEND_API_KEY 실값 시 isEnabled=true', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.EMAIL_FROM_ADDRESS = 'sender@example.test'
    process.env.RESEND_API_KEY = 're_test_realkey_12345'
    const service = createEmailService()
    expect(service.isEnabled()).toBe(true)
    expect(service.getProviderName()).toBe('resend')
  })

  it('EMAIL_PROVIDER=sendgrid + SENDGRID_API_KEY 미설정 시 isEnabled=false', () => {
    process.env.EMAIL_PROVIDER = 'sendgrid'
    delete process.env.SENDGRID_API_KEY
    const service = createEmailService()
    expect(service).toBeInstanceOf(SendgridEmailAdapter)
    expect(service.isEnabled()).toBe(false)
    expect(service.getProviderName()).toBe('sendgrid')
  })

  it('EMAIL_PROVIDER=sendgrid + SENDGRID_API_KEY 실값 시 isEnabled=true', () => {
    process.env.EMAIL_PROVIDER = 'sendgrid'
    process.env.EMAIL_FROM_ADDRESS = 'sender@example.test'
    process.env.SENDGRID_API_KEY = 'SG.realkey_12345'
    const service = createEmailService()
    expect(service.isEnabled()).toBe(true)
  })

  it('EMAIL_PROVIDER=ses (미지원) 시 NullEmailAdapter 폴백', () => {
    process.env.EMAIL_PROVIDER = 'ses'
    const service = createEmailService()
    expect(service).toBeInstanceOf(NullEmailAdapter)
    expect(service.isEnabled()).toBe(false)
  })

  it('EMAIL_PROVIDER=postmark (미지원) 시 NullEmailAdapter 폴백', () => {
    process.env.EMAIL_PROVIDER = 'postmark'
    const service = createEmailService()
    expect(service).toBeInstanceOf(NullEmailAdapter)
  })

  it('EMAIL_PROVIDER 대소문자 무관 (RESEND → resend)', () => {
    process.env.EMAIL_PROVIDER = 'RESEND'
    process.env.RESEND_API_KEY = 're_test_uppercase'
    const service = createEmailService()
    expect(service).toBeInstanceOf(ResendEmailAdapter)
  })
})
