import { SendgridEmailAdapter } from './sendgrid-email.adapter'

/**
 * SendgridEmailAdapter spec — 사용자 절대 규정 0-1 정합 검증.
 *
 * 외부 호출 0건 강제 (API key 미설정 시).
 */
describe('SendgridEmailAdapter', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('isEnabled / getProviderName', () => {
    it('SENDGRID_API_KEY 미설정 시 isEnabled=false', () => {
      delete process.env.SENDGRID_API_KEY
      const adapter = new SendgridEmailAdapter()
      expect(adapter.isEnabled()).toBe(false)
      expect(adapter.getProviderName()).toBe('sendgrid')
    })

    it('SENDGRID_API_KEY=placeholder 시 isEnabled=false', () => {
      process.env.SENDGRID_API_KEY = 'placeholder'
      const adapter = new SendgridEmailAdapter()
      expect(adapter.isEnabled()).toBe(false)
    })

    it('SENDGRID_API_KEY 실값 시 isEnabled=true', () => {
      process.env.SENDGRID_API_KEY = 'SG.realkey_12345'
      const adapter = new SendgridEmailAdapter()
      expect(adapter.isEnabled()).toBe(true)
    })
  })

  describe('sendXxx — API key 미설정 시 외부 호출 0 + throw', () => {
    it('sendVerificationEmail throw "API key 미설정"', async () => {
      delete process.env.SENDGRID_API_KEY
      const adapter = new SendgridEmailAdapter()
      await expect(
        adapter.sendVerificationEmail({
          to: 'test@example.com',
          token: 'sg-token',
          expireAt: new Date('2026-05-28T00:00:00Z'),
        }),
      ).rejects.toThrow('API key 미설정')
    })

    it('sendPasswordResetEmail throw "API key 미설정"', async () => {
      process.env.SENDGRID_API_KEY = 'placeholder'
      const adapter = new SendgridEmailAdapter()
      await expect(
        adapter.sendPasswordResetEmail({
          to: 'test@example.com',
          token: 'pw',
          expireAt: new Date('2026-05-28T00:00:00Z'),
        }),
      ).rejects.toThrow('API key 미설정')
    })

    it('sendPaymentNotification throw "API key 미설정"', async () => {
      delete process.env.SENDGRID_API_KEY
      const adapter = new SendgridEmailAdapter()
      await expect(
        adapter.sendPaymentNotification({
          to: 'test@example.com',
          type: 'payment_refunded',
          payload: { paymentId: 'p1', refundedAmount: 5000, deficitCredits: 0 },
        }),
      ).rejects.toThrow('API key 미설정')
    })
  })
})
