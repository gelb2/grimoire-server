import { RefundPaymentUseCase } from './refund-payment.usecase'
import { BadRequestException } from '@nestjs/common'

describe('RefundPaymentUseCase', () => {
  let useCase: RefundPaymentUseCase
  let mockPaymentRepo: {
    refundPaymentAtomically: jest.Mock
    findByExternalTransactionId: jest.Mock
    completePaymentAtomically: jest.Mock
    create: jest.Mock
    updateExternalTransactionId: jest.Mock
    findByAuthorId: jest.Mock
    updateStatus: jest.Mock
    findPendingPaymentsOlderThan: jest.Mock
    expirePayment: jest.Mock
  }
  let mockAuditLogService: {
    log: jest.Mock
    findAll: jest.Mock
  }

  const baseInput = {
    paymentId: 'pay-1',
    authorId: 'author-1',
    credits: 50,
    refundedAmount: 5000,
    reason: 'polar_webhook_order.refunded',
    source: 'webhook' as const,
  }

  beforeEach(() => {
    mockPaymentRepo = {
      refundPaymentAtomically: jest.fn(),
      findByExternalTransactionId: jest.fn(),
      completePaymentAtomically: jest.fn(),
      create: jest.fn(),
      updateExternalTransactionId: jest.fn(),
      findByAuthorId: jest.fn(),
      updateStatus: jest.fn(),
      findPendingPaymentsOlderThan: jest.fn(),
      expirePayment: jest.fn(),
    }
    mockAuditLogService = {
      log: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn(),
    }
    useCase = new RefundPaymentUseCase(
      mockPaymentRepo as never,
      mockAuditLogService as never,
    )
  })

  describe('정상 환수 (Author.credits >= credits)', () => {
    it('credits=50 보유 시 50 decrement + deficitCredits=0 + auditLog action=refund_normal 박제', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 50,
        deficitCredits: 0,
      })

      const result = await useCase.execute(baseInput)

      // refundPaymentAtomically — 입력 정합 검증
      expect(mockPaymentRepo.refundPaymentAtomically).toHaveBeenCalledTimes(1)
      expect(mockPaymentRepo.refundPaymentAtomically).toHaveBeenCalledWith({
        paymentId: 'pay-1',
        authorId: 'author-1',
        credits: 50,
        refundedAmount: 5000,
        reason: 'polar_webhook_order.refunded',
        source: 'webhook',
      })

      // AuditLog — 정상 분기
      expect(mockAuditLogService.log).toHaveBeenCalledTimes(1)
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'system_refund',
        'refund_normal',
        'pay-1',
        expect.objectContaining({
          authorId: 'author-1',
          refundedAmount: 5000,
          creditsRequested: 50,
          creditsActuallyDeducted: 50,
          deficitCredits: 0,
          reason: 'polar_webhook_order.refunded',
          source: 'webhook',
        }),
      )

      // 반환값 검증
      expect(result).toEqual({ actualDeducted: 50, deficitCredits: 0 })
    })

    it('source=manual 시 reason은 그대로 박제되고 auditLog detail.source=manual로 박제', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 30,
        deficitCredits: 0,
      })

      await useCase.execute({
        ...baseInput,
        credits: 30,
        source: 'manual',
        reason: 'admin_manual_refund_user_request',
      })

      // mock.calls[0][0] — 첫 호출의 첫 인자 (객체) 정밀 검증
      expect(mockPaymentRepo.refundPaymentAtomically.mock.calls[0][0]).toEqual({
        paymentId: 'pay-1',
        authorId: 'author-1',
        credits: 30,
        refundedAmount: 5000,
        reason: 'admin_manual_refund_user_request',
        source: 'manual',
      })

      // AuditLog detail — source=manual 박제
      expect(mockAuditLogService.log.mock.calls[0][3]).toEqual(
        expect.objectContaining({ source: 'manual', reason: 'admin_manual_refund_user_request' }),
      )
    })
  })

  describe('deficit 환수 (Author.credits < credits)', () => {
    it('credits=50 요청 + 잔액 30 시 actualDeducted=30 + deficitCredits=20 + action=refund_deficit', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 30,
        deficitCredits: 20,
      })

      const result = await useCase.execute(baseInput)

      // refundPaymentAtomically — 요청 인자는 credits=50 그대로 전달 (repo 내부에서 잔액 조회 후 조정)
      expect(mockPaymentRepo.refundPaymentAtomically).toHaveBeenCalledWith(
        expect.objectContaining({ credits: 50 }),
      )

      // AuditLog — deficit 분기 (action 식별자 + detail 박제)
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'system_refund',
        'refund_deficit',
        'pay-1',
        expect.objectContaining({
          creditsRequested: 50,
          creditsActuallyDeducted: 30,
          deficitCredits: 20,
        }),
      )

      // 반환값 — deficit 운영자 추적용
      expect(result.actualDeducted).toBe(30)
      expect(result.deficitCredits).toBe(20)
    })

    it('잔액 0 시 actualDeducted=0 + deficitCredits=credits 전체 + action=refund_deficit', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 0,
        deficitCredits: 50,
      })

      const result = await useCase.execute(baseInput)

      expect(result).toEqual({ actualDeducted: 0, deficitCredits: 50 })
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'system_refund',
        'refund_deficit',
        'pay-1',
        expect.objectContaining({ deficitCredits: 50, creditsActuallyDeducted: 0 }),
      )
    })
  })

  describe('boundary — 잔액 정확히 같음', () => {
    it('잔액=credits 정확 일치 시 정상 분기 (deficitCredits=0, action=refund_normal)', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 50,
        deficitCredits: 0,
      })

      await useCase.execute(baseInput)

      // boundary는 정상 분기 — refund_normal 박제 (refund_deficit 아님)
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'system_refund',
        'refund_normal',
        'pay-1',
        expect.objectContaining({ deficitCredits: 0 }),
      )
      // refund_deficit으로는 호출되지 않음 (회귀)
      const auditCallActions = mockAuditLogService.log.mock.calls.map((c) => c[1])
      expect(auditCallActions).not.toContain('refund_deficit')
    })
  })

  describe('예외 처리', () => {
    it('credits 음수 입력 시 BadRequestException + repo/auditLog 호출 0회', async () => {
      await expect(
        useCase.execute({ ...baseInput, credits: -10 }),
      ).rejects.toThrow(BadRequestException)

      expect(mockPaymentRepo.refundPaymentAtomically).not.toHaveBeenCalled()
      expect(mockAuditLogService.log).not.toHaveBeenCalled()
    })

    it('repository 환수 트랜잭션 실패 시 throw 위임 + auditLog 호출 0회 (성공 박제 차단)', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockRejectedValueOnce(
        new Error('payment not found or already refunded'),
      )

      await expect(useCase.execute(baseInput)).rejects.toThrow('payment not found or already refunded')

      expect(mockPaymentRepo.refundPaymentAtomically).toHaveBeenCalledTimes(1)
      // 트랜잭션 실패 시 auditLog는 호출 0회 (성공 박제 차단)
      expect(mockAuditLogService.log).not.toHaveBeenCalled()
    })

    it('AuditLog 박제 실패 시에도 환수 결과는 반환 (auditLog는 후행 — 트랜잭션 외)', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 50,
        deficitCredits: 0,
      })
      mockAuditLogService.log.mockRejectedValueOnce(new Error('audit_log_db_down'))

      // AuditLog 실패는 throw하지 않음 — 환수는 이미 commit됨
      const result = await useCase.execute(baseInput)

      expect(result).toEqual({ actualDeducted: 50, deficitCredits: 0 })
      expect(mockPaymentRepo.refundPaymentAtomically).toHaveBeenCalledTimes(1)
      expect(mockAuditLogService.log).toHaveBeenCalledTimes(1)
    })
  })

  describe('reason 박제 정합', () => {
    it('reason은 입력 그대로 refundPaymentAtomically + auditLog detail에 전달', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 50,
        deficitCredits: 0,
      })

      await useCase.execute({
        ...baseInput,
        reason: 'polar_webhook_order.refunded_dispute_resolved',
      })

      expect(mockPaymentRepo.refundPaymentAtomically.mock.calls[0][0].reason).toBe(
        'polar_webhook_order.refunded_dispute_resolved',
      )
      expect(mockAuditLogService.log.mock.calls[0][3]).toEqual(
        expect.objectContaining({ reason: 'polar_webhook_order.refunded_dispute_resolved' }),
      )
    })
  })
})
