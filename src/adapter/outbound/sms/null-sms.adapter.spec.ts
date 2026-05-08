import { NullSmsAdapter } from './null-sms.adapter'

describe('NullSmsAdapter (PAY-P2-3 사전 작업)', () => {
  let adapter: NullSmsAdapter

  beforeEach(() => {
    adapter = new NullSmsAdapter()
  })

  describe('isEnabled', () => {
    it('항상 false 반환 (외부 API 의존 0건 — 절대 규정 0-1 정합)', () => {
      expect(adapter.isEnabled()).toBe(false)
    })
  })

  describe('getProviderName', () => {
    it("'null' 반환 (provider 식별자)", () => {
      expect(adapter.getProviderName()).toBe('null')
    })
  })

  describe('sendPaymentNotification', () => {
    it.each([
      ['payment_success' as const, { paymentId: 'p-1', amount: 5000, credits: 50, productName: '50 크레딧' }],
      ['payment_failed' as const, { paymentId: 'p-2', amount: 5000, productName: '50 크레딧' }],
      [
        'payment_refunded' as const,
        {
          paymentId: 'p-3',
          refundedAmount: 2500,
          credits: 25,
          deficitCredits: 0,
          reason: 'polar_webhook_order.refunded',
          isPartial: true,
        },
      ],
    ])('type=%s 발송 시도 시에도 messageId=null + provider=null 반환 (실 발송 0건)', async (type, payload) => {
      const result = await adapter.sendPaymentNotification({
        to: '+821012345678',
        type,
        displayName: '사슴악마',
        payload,
      })

      expect(result).toEqual({ messageId: null, provider: 'null' })
    })

    it('PII 마스킹 — 로그에 평문 전화번호 박제 0건', async () => {
      const loggerSpy = jest.spyOn(adapter['logger'], 'warn')

      await adapter.sendPaymentNotification({
        to: '+821012345678',
        type: 'payment_success',
        payload: { paymentId: 'p-1', amount: 5000, credits: 50 },
      })

      expect(loggerSpy).toHaveBeenCalledTimes(1)
      const logArg = loggerSpy.mock.calls[0][0] as string
      // 평문 전화번호 박제 차단
      expect(logArg).not.toContain('+821012345678')
      // 마스킹 형식 — 앞 4자 + **** + 뒤 4자
      expect(logArg).toContain('+821****5678')
      expect(logArg).toContain('payment_success')
    })
  })

  describe('sendVerificationCode', () => {
    it('messageId=null + provider=null 반환 (실 발송 0건)', async () => {
      const result = await adapter.sendVerificationCode({
        to: '+821098765432',
        code: '123456',
        displayName: '검증 사용자',
        expireAt: new Date('2026-05-05T05:00:00Z'),
      })

      expect(result).toEqual({ messageId: null, provider: 'null' })
    })

    it('PII 마스킹 — 로그에 평문 코드 박제 0건', async () => {
      const loggerSpy = jest.spyOn(adapter['logger'], 'warn')

      await adapter.sendVerificationCode({
        to: '+821098765432',
        code: '123456',
        expireAt: new Date('2026-05-05T05:00:00Z'),
      })

      expect(loggerSpy).toHaveBeenCalledTimes(1)
      const logArg = loggerSpy.mock.calls[0][0] as string
      // 평문 6자리 코드 박제 차단
      expect(logArg).not.toContain('123456')
      // 첫 1자 + *** 패턴
      expect(logArg).toContain('1***')
      // 만료 시각은 ISO 형식 그대로 박제 (PII 아님)
      expect(logArg).toContain('2026-05-05T05:00:00.000Z')
    })

    it('짧은 코드 (≤2자) 시 *** 박제 (마스킹 안전망)', async () => {
      const loggerSpy = jest.spyOn(adapter['logger'], 'warn')

      await adapter.sendVerificationCode({
        to: '+821011112222',
        code: 'ab',
        expireAt: new Date('2026-05-05T05:00:00Z'),
      })

      const logArg = loggerSpy.mock.calls[0][0] as string
      expect(logArg).toContain('***')
      expect(logArg).not.toContain('code=ab ')
    })
  })

  describe('전화번호 마스킹 boundary', () => {
    it('짧은 전화번호 (≤4자) 시 *** 박제', async () => {
      const loggerSpy = jest.spyOn(adapter['logger'], 'warn')

      await adapter.sendPaymentNotification({
        to: '1234',
        type: 'payment_success',
        payload: {},
      })

      const logArg = loggerSpy.mock.calls[0][0] as string
      expect(logArg).toContain('to=***')
      expect(logArg).not.toContain('to=1234 ')
    })
  })
})
