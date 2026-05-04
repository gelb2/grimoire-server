import { NullEmailAdapter } from './null-email.adapter'

describe('NullEmailAdapter', () => {
  let adapter: NullEmailAdapter

  beforeEach(() => {
    adapter = new NullEmailAdapter()
  })

  describe('isEnabled', () => {
    it('항상 false 반환 (외부 API 의존 0건)', () => {
      expect(adapter.isEnabled()).toBe(false)
    })
  })

  describe('getProviderName', () => {
    it("'null' 반환", () => {
      expect(adapter.getProviderName()).toBe('null')
    })
  })

  describe('sendVerificationEmail', () => {
    it('messageId=null + provider=null 반환 (실제 발송 0건)', async () => {
      const result = await adapter.sendVerificationEmail({
        to: 'test@example.com',
        token: 'abc123token',
        displayName: 'Test User',
        expireAt: new Date('2026-05-06T00:00:00Z'),
      })

      expect(result).toEqual({ messageId: null, provider: 'null' })
    })

    it('PII 마스킹 — 로그에 평문 토큰/이메일 박제 0건', async () => {
      const loggerSpy = jest.spyOn(adapter['logger'], 'warn')

      await adapter.sendVerificationEmail({
        to: 'deerdevil@example.com',
        token: 'verylongtoken12345',
        expireAt: new Date('2026-05-06T00:00:00Z'),
      })

      expect(loggerSpy).toHaveBeenCalledTimes(1)
      const logArg = loggerSpy.mock.calls[0][0] as string
      expect(logArg).not.toContain('verylongtoken12345')
      expect(logArg).toContain('very***')
      expect(logArg).toContain('d***l@example.com')
    })
  })

  describe('sendPasswordResetEmail', () => {
    it('messageId=null + provider=null 반환', async () => {
      const result = await adapter.sendPasswordResetEmail({
        to: 'reset@example.com',
        token: 'reset-token-xyz',
        expireAt: new Date('2026-05-05T01:00:00Z'),
      })

      expect(result).toEqual({ messageId: null, provider: 'null' })
    })
  })

  describe('sendPaymentNotification', () => {
    it.each([
      ['payment_success' as const, { paymentId: 'p-1', amount: 5000, credits: 50 }],
      ['payment_failed' as const, { paymentId: 'p-2', amount: 5000 }],
      ['payment_refunded' as const, { paymentId: 'p-3', refundedAmount: 5000, deficitCredits: 0 }],
    ])('type=%s 발송 시도 시에도 messageId=null + provider=null 반환', async (type, payload) => {
      const result = await adapter.sendPaymentNotification({
        to: 'user@example.com',
        type,
        payload,
      })

      expect(result).toEqual({ messageId: null, provider: 'null' })
    })
  })
})
