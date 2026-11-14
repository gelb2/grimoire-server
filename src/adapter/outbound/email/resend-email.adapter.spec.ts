import { ResendEmailAdapter } from './resend-email.adapter'

/**
 * ResendEmailAdapter spec — 사용자 절대 규정 0-1 정합 검증.
 *
 * 외부 호출 0건 강제:
 * - API key 미설정 시 isEnabled=false + sendXxx throw
 * - placeholder 시 isEnabled=false + sendXxx throw
 * - Resend SDK 호출은 mock 환경(실 호출 0)
 */
describe('ResendEmailAdapter', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.EMAIL_FROM_ADDRESS = 'sender@example.test'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('isEnabled / getProviderName', () => {
    it('발신자 미설정이면 API 키가 있어도 발송하지 않는다', async () => {
      process.env.RESEND_API_KEY = 'test-key'
      delete process.env.EMAIL_FROM_ADDRESS
      const adapter = new ResendEmailAdapter()
      expect(adapter.isEnabled()).toBe(false)
      await expect(adapter.sendPaymentNotification({
        to: 'reader@example.test', type: 'payment_success', payload: {},
      })).rejects.toThrow('외부 호출 차단')
    })

    it('RESEND_API_KEY 미설정 시 isEnabled=false', () => {
      delete process.env.RESEND_API_KEY
      const adapter = new ResendEmailAdapter()
      expect(adapter.isEnabled()).toBe(false)
      expect(adapter.getProviderName()).toBe('resend')
    })

    it('RESEND_API_KEY=placeholder 시 isEnabled=false', () => {
      process.env.RESEND_API_KEY = 'placeholder'
      const adapter = new ResendEmailAdapter()
      expect(adapter.isEnabled()).toBe(false)
    })

    it('RESEND_API_KEY 실값 시 isEnabled=true', () => {
      process.env.RESEND_API_KEY = 're_test_realkey_12345'
      const adapter = new ResendEmailAdapter()
      expect(adapter.isEnabled()).toBe(true)
    })
  })

  describe('sendXxx — API key 미설정 시 외부 호출 0 + throw', () => {
    it('sendVerificationEmail throw "API key 미설정"', async () => {
      delete process.env.RESEND_API_KEY
      const adapter = new ResendEmailAdapter()
      await expect(
        adapter.sendVerificationEmail({
          to: 'test@example.com',
          token: 'abc123',
          expireAt: new Date('2026-05-28T00:00:00Z'),
        }),
      ).rejects.toThrow('API key 미설정')
    })

    it('sendPasswordResetEmail throw "API key 미설정"', async () => {
      process.env.RESEND_API_KEY = 'placeholder'
      const adapter = new ResendEmailAdapter()
      await expect(
        adapter.sendPasswordResetEmail({
          to: 'test@example.com',
          token: 'pw-token',
          expireAt: new Date('2026-05-28T00:00:00Z'),
        }),
      ).rejects.toThrow('API key 미설정')
    })

    it('sendPaymentNotification throw "API key 미설정"', async () => {
      delete process.env.RESEND_API_KEY
      const adapter = new ResendEmailAdapter()
      await expect(
        adapter.sendPaymentNotification({
          to: 'test@example.com',
          type: 'payment_success',
          payload: { paymentId: 'p1', amount: 5000, credits: 50 },
        }),
      ).rejects.toThrow('API key 미설정')
    })
  })

  describe('HTML escape — XSS 차단', () => {
    it('sendVerificationEmail 내부 HTML escape (script 태그 무력화)', async () => {
      process.env.RESEND_API_KEY = 're_test_realkey_12345'
      const adapter = new ResendEmailAdapter()
      // private renderVerificationHtml 결과를 sendVerificationEmail 호출로 trigger
      // → Resend.send를 spy해서 호출 body 검증 (외부 호출 차단 — mock)
      const mockSend = jest
        .fn()
        .mockResolvedValue({ data: { id: 'msg-id-1' }, error: null })
      // private client 교체
      ;(adapter as unknown as { client: { emails: { send: jest.Mock } } }).client = {
        emails: { send: mockSend },
      }

      const result = await adapter.sendVerificationEmail({
        to: 'safe@example.com',
        token: '<script>alert(1)</script>',
        displayName: '<img src=x onerror=evil>',
        expireAt: new Date('2026-05-28T00:00:00Z'),
      })

      expect(result).toEqual({ messageId: 'msg-id-1', provider: 'resend' })
      expect(mockSend).toHaveBeenCalledTimes(1)
      const sendArg = mockSend.mock.calls[0][0]
      expect(sendArg.html).not.toContain('<script>alert(1)</script>')
      expect(sendArg.html).toContain('&lt;script&gt;')
      expect(sendArg.html).toContain('&lt;img src=x onerror=evil&gt;')
    })
  })
})
