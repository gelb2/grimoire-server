import { Test, TestingModule } from '@nestjs/testing'
import { PaymentNotificationUseCase } from './payment-notification.usecase'
import { EmailServicePort } from '@domain/port/outbound/email-service.port'
import { SmsServicePort } from '@domain/port/outbound/sms-service.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'

/**
 * PaymentNotificationUseCase spec — CLAUDE.md §9 결제 트랜잭션 원자성 정합 검증.
 *
 * 핵심 검증:
 * - 모든 adapter NullAdapter 시 외부 호출 0건 + skipped=true 반환
 * - email/sms 발송 실패 시 throw 0 (호출자 결제 트랜잭션 영향 0)
 * - enumeration 차단 — author not found 시 skip
 */
describe('PaymentNotificationUseCase', () => {
  let useCase: PaymentNotificationUseCase
  let emailService: jest.Mocked<EmailServicePort>
  let smsService: jest.Mocked<SmsServicePort>
  let authorRepo: jest.Mocked<AuthorRepositoryPort>

  beforeEach(async () => {
    emailService = {
      sendVerificationEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
      sendPaymentNotification: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(false),
      getProviderName: jest.fn().mockReturnValue('null'),
    }
    smsService = {
      sendPaymentNotification: jest.fn(),
      sendVerificationCode: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(false),
      getProviderName: jest.fn().mockReturnValue('null'),
    }
    authorRepo = {
      findById: jest.fn(),
      findBySlug: jest.fn(),
      findByEmail: jest.fn(),
    } as unknown as jest.Mocked<AuthorRepositoryPort>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentNotificationUseCase,
        { provide: 'EmailServicePort', useValue: emailService },
        { provide: 'SmsServicePort', useValue: smsService },
        { provide: 'AuthorRepositoryPort', useValue: authorRepo },
      ],
    }).compile()

    useCase = module.get(PaymentNotificationUseCase)
  })

  describe('NullAdapter (default) — 사용자 절대 규정 0-1 정합', () => {
    it('notifyChargeSuccess — 모든 adapter NullAdapter 시 외부 호출 0 + skipped=true', async () => {
      emailService.isEnabled.mockReturnValue(false)
      smsService.isEnabled.mockReturnValue(false)

      const result = await useCase.notifyChargeSuccess({
        paymentId: 'p1',
        authorId: 'a1',
        amount: 5000,
        credits: 50,
        productName: '50pt 충전',
      })

      expect(result.skipped).toBe(true)
      expect(result.reason).toBe('all_adapters_disabled')
      expect(emailService.sendPaymentNotification).not.toHaveBeenCalled()
      expect(smsService.sendPaymentNotification).not.toHaveBeenCalled()
      expect(authorRepo.findById).not.toHaveBeenCalled() // adapter 0 시 author 조회도 skip (성능)
    })

    it('notifyRefundProcessed — NullAdapter 시 호출 0', async () => {
      emailService.isEnabled.mockReturnValue(false)
      smsService.isEnabled.mockReturnValue(false)

      const result = await useCase.notifyRefundProcessed({
        paymentId: 'p1',
        authorId: 'a1',
        refundedAmount: 5000,
        actualRefunded: 50,
        deficitIncurred: 0,
        isPartial: false,
        reason: 'polar_webhook_order.refunded',
      })

      expect(result.skipped).toBe(true)
      expect(emailService.sendPaymentNotification).not.toHaveBeenCalled()
    })
  })

  describe('Email enabled — 실 호출', () => {
    beforeEach(() => {
      emailService.isEnabled.mockReturnValue(true)
      emailService.getProviderName.mockReturnValue('resend')
      authorRepo.findById.mockResolvedValue({
        id: 'a1',
        slug: 'test',
        name: 'Test User',
        email: 'test@example.com',
        role: 'user',
      } as never)
      emailService.sendPaymentNotification.mockResolvedValue({
        messageId: 'msg-1',
        provider: 'resend',
      })
    })

    it('notifyChargeSuccess — email 1회 호출 + emailSent=true', async () => {
      const result = await useCase.notifyChargeSuccess({
        paymentId: 'p1',
        authorId: 'a1',
        amount: 5000,
        credits: 50,
      })

      expect(result.emailSent).toBe(true)
      expect(result.skipped).toBe(false)
      expect(emailService.sendPaymentNotification).toHaveBeenCalledWith({
        to: 'test@example.com',
        type: 'payment_success',
        displayName: 'Test User',
        payload: expect.objectContaining({
          paymentId: 'p1',
          amount: 5000,
          credits: 50,
        }),
      })
    })

    it('notifyChargeFailed — type=payment_failed', async () => {
      await useCase.notifyChargeFailed({
        paymentId: 'p2',
        authorId: 'a1',
        amount: 5000,
      })

      expect(emailService.sendPaymentNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment_failed' }),
      )
    })

    it('notifyRefundProcessed — payload에 deficitCredits + isPartial 포함', async () => {
      await useCase.notifyRefundProcessed({
        paymentId: 'p1',
        authorId: 'a1',
        refundedAmount: 5000,
        actualRefunded: 50,
        deficitIncurred: 0,
        isPartial: false,
        reason: 'polar_webhook_order.refunded',
      })

      const callArg = emailService.sendPaymentNotification.mock.calls[0][0]
      expect(callArg.type).toBe('payment_refunded')
      expect(callArg.payload).toMatchObject({
        deficitCredits: 0,
        isPartial: false,
      })
    })

    it('email 발송 실패 시 throw 0 + emailSent=false (결제 트랜잭션 보존)', async () => {
      emailService.sendPaymentNotification.mockRejectedValue(new Error('Resend network error'))

      const result = await useCase.notifyChargeSuccess({
        paymentId: 'p1',
        authorId: 'a1',
        amount: 5000,
        credits: 50,
      })

      // CRITICAL — 결제 commit 보존, 알림 실패가 throw 발생시키지 않음
      expect(result.emailSent).toBe(false)
      expect(result.skipped).toBe(true)
    })

    it('author not found 시 skipped + reason="author_not_found"', async () => {
      authorRepo.findById.mockResolvedValue(null)

      const result = await useCase.notifyChargeSuccess({
        paymentId: 'p1',
        authorId: 'unknown',
        amount: 5000,
        credits: 50,
      })

      expect(result.skipped).toBe(true)
      expect(result.reason).toBe('author_not_found')
      expect(emailService.sendPaymentNotification).not.toHaveBeenCalled()
    })

    it('author 조회 throw 시 silent skip + 결제 commit 보존', async () => {
      authorRepo.findById.mockRejectedValue(new Error('DB connection lost'))

      const result = await useCase.notifyChargeSuccess({
        paymentId: 'p1',
        authorId: 'a1',
        amount: 5000,
        credits: 50,
      })

      expect(result.skipped).toBe(true)
      expect(emailService.sendPaymentNotification).not.toHaveBeenCalled()
    })
  })

  describe('notifySubscriptionRenewal', () => {
    it('NullAdapter 시 호출 0 + skipped=true', async () => {
      emailService.isEnabled.mockReturnValue(false)
      smsService.isEnabled.mockReturnValue(false)

      const result = await useCase.notifySubscriptionRenewal({
        authorId: 'a1',
        tier: 'pro',
        monthlyPoolPoints: 105000,
        expiresAt: new Date('2026-06-27T00:00:00Z'),
      })

      expect(result.skipped).toBe(true)
    })

    it('Email enabled 시 payment_success 템플릿 재사용 + productName="PRO 구독"', async () => {
      emailService.isEnabled.mockReturnValue(true)
      emailService.getProviderName.mockReturnValue('resend')
      authorRepo.findById.mockResolvedValue({
        id: 'a1',
        slug: 'test',
        name: 'Test',
        email: 'test@example.com',
        role: 'user',
      } as never)
      emailService.sendPaymentNotification.mockResolvedValue({
        messageId: 'msg-2',
        provider: 'resend',
      })

      await useCase.notifySubscriptionRenewal({
        authorId: 'a1',
        tier: 'pro',
        monthlyPoolPoints: 105000,
        expiresAt: new Date('2026-06-27T00:00:00Z'),
      })

      const callArg = emailService.sendPaymentNotification.mock.calls[0][0]
      expect(callArg.type).toBe('payment_success')
      expect(callArg.payload).toMatchObject({
        productName: 'PRO 구독',
        credits: 105000,
      })
    })
  })
})
