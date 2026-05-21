/**
 * RefundPaymentUseCase spec — CC-2b (2026-05-20) 신 경로.
 *
 * usecase 자체의 책임:
 *  - 입력 검증 (refundPt ≥ 0 / refundedAmount > 0)
 *  - paymentRepo.refundPaymentWithPoints 호출 정합 (CC-2b 신 메서드)
 *  - balanceBefore 조회 (ledger 우선, fallback authorRepo)
 *  - auditLog 분기 (정상/deficit × 전액/부분 4 액션) + state JSON 박제
 *  - logger warn/log 분기
 *
 * 회계 정밀(4 출처 환수·비례·CAS·이중 외상 통합)은 prisma-payment.repository.refundPaymentWithPoints
 * 와 통합 spec(`credit-gift-refund-integration.spec.ts` C7c/C7d)이 검증.
 */
import { RefundPaymentUseCase } from './refund-payment.usecase'
import { BadRequestException } from '@nestjs/common'

describe('RefundPaymentUseCase — CC-2b 신 경로 + 이중 외상 통합', () => {
  let useCase: RefundPaymentUseCase
  let mockPaymentRepo: {
    refundPaymentWithPoints: jest.Mock
    refundPaymentAtomically: jest.Mock
    findByExternalTransactionId: jest.Mock
    completePaymentAtomically: jest.Mock
    completePaymentWithPoints: jest.Mock
    create: jest.Mock
    updateExternalTransactionId: jest.Mock
    findByAuthorId: jest.Mock
    updateStatus: jest.Mock
    findPendingPaymentsOlderThan: jest.Mock
    expirePayment: jest.Mock
    findReusablePendingPayment: jest.Mock
  }
  let mockAuditLogService: {
    log: jest.Mock
    findAll: jest.Mock
  }
  let mockAuthorRepo: { findById: jest.Mock }
  let mockLedger: { getBalance: jest.Mock }

  const baseInput = {
    paymentId: 'pay-1',
    authorId: 'author-1',
    refundPt: 25000,
    refundedAmount: 3000,
    reason: 'polar_webhook_order.refunded',
    source: 'webhook' as const,
  }

  /** 정상 환수 — 4 출처 합 25,000 ≥ refundPt 25,000 */
  const baseBalance = {
    free: 0,
    subscription: 0,
    gift: 0,
    charged: 25000,
    total: 25000,
    deficit: 0,
    available: 25000,
  }

  beforeEach(() => {
    mockPaymentRepo = {
      refundPaymentWithPoints: jest.fn(),
      refundPaymentAtomically: jest.fn(),
      findByExternalTransactionId: jest.fn(),
      completePaymentAtomically: jest.fn(),
      completePaymentWithPoints: jest.fn(),
      create: jest.fn(),
      updateExternalTransactionId: jest.fn(),
      findByAuthorId: jest.fn(),
      updateStatus: jest.fn(),
      findPendingPaymentsOlderThan: jest.fn(),
      expirePayment: jest.fn(),
      findReusablePendingPayment: jest.fn(),
    }
    mockAuditLogService = {
      log: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn(),
    }
    mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'author-1', slug: 'a', name: 'A', email: 'a@a.com',
        role: 'user', credits: 25000, plan: 'free', planExpireAt: null, createdAt: new Date(),
      }),
    }
    mockLedger = {
      getBalance: jest.fn().mockResolvedValue(baseBalance),
    }
    useCase = new RefundPaymentUseCase(
      mockPaymentRepo as never,
      mockAuditLogService as never,
      mockAuthorRepo as never,
      mockLedger as never,
    )
  })

  describe('입력 검증', () => {
    it('refundPt 음수면 BadRequest', async () => {
      await expect(
        useCase.execute({ ...baseInput, refundPt: -1 }),
      ).rejects.toThrow(BadRequestException)
      expect(mockPaymentRepo.refundPaymentWithPoints).not.toHaveBeenCalled()
    })

    it('refundedAmount 0 이하면 BadRequest', async () => {
      await expect(
        useCase.execute({ ...baseInput, refundedAmount: 0 }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        useCase.execute({ ...baseInput, refundedAmount: -100 }),
      ).rejects.toThrow(BadRequestException)
      expect(mockPaymentRepo.refundPaymentWithPoints).not.toHaveBeenCalled()
    })
  })

  describe('CC-2b 신 메서드 호출 정합 — refundPaymentWithPoints', () => {
    it('CC-2b 후 — refundPaymentWithPoints 1회 호출 (refundPt/refundedAmount/source 그대로)', async () => {
      mockPaymentRepo.refundPaymentWithPoints.mockResolvedValueOnce({
        actualRefunded: 25000,
        deficitIncurred: 0,
        proportionalPt: 25000,
        isPartial: false,
      })

      await useCase.execute(baseInput)

      expect(mockPaymentRepo.refundPaymentWithPoints).toHaveBeenCalledTimes(1)
      expect(mockPaymentRepo.refundPaymentWithPoints).toHaveBeenCalledWith({
        paymentId: 'pay-1',
        authorId: 'author-1',
        refundPt: 25000,
        refundedAmount: 3000,
        reason: 'polar_webhook_order.refunded',
        source: 'webhook',
      })
      // 구 메서드(`refundPaymentAtomically`)는 호출되지 않는다 — 신 경로 이행 박제
      expect(mockPaymentRepo.refundPaymentAtomically).not.toHaveBeenCalled()
    })

    it('정상 전액 환수 — auditLog action=refund_normal + before/after 4출처 박제', async () => {
      mockPaymentRepo.refundPaymentWithPoints.mockResolvedValueOnce({
        actualRefunded: 25000,
        deficitIncurred: 0,
        proportionalPt: 25000,
        isPartial: false,
      })

      const result = await useCase.execute(baseInput)

      expect(result).toEqual({
        actualRefunded: 25000,
        deficitIncurred: 0,
        proportionalPt: 25000,
        isPartial: false,
      })

      // auditLog — refund_normal + beforeState(4 출처 + deficit 0) + afterState
      expect(mockAuditLogService.log).toHaveBeenCalledTimes(1)
      const [op, action, ref, detail, before, after] = mockAuditLogService.log.mock.calls[0]
      expect(op).toBe('system_refund')
      expect(action).toBe('refund_normal')
      expect(ref).toBe('pay-1')
      expect(detail).toEqual(
        expect.objectContaining({
          authorId: 'author-1',
          refundedAmount: 3000,
          refundPtRequested: 25000,
          proportionalPt: 25000,
          actualRefunded: 25000,
          deficitIncurred: 0,
          isPartial: false,
          source: 'webhook',
        }),
      )
      expect(before).toEqual(
        expect.objectContaining({
          charged: 25000,
          total: 25000,
          deficit: 0,
          paymentStatus: 'completed',
        }),
      )
      expect(after).toEqual(
        expect.objectContaining({
          total: 0,
          deficit: 0,
          paymentStatus: 'refunded',
          actualRefunded: 25000,
          deficitIncurred: 0,
        }),
      )
    })

    it('부분 환불 정상 — auditLog action=refund_partial + paymentStatus=partial_refunded', async () => {
      mockPaymentRepo.refundPaymentWithPoints.mockResolvedValueOnce({
        actualRefunded: 12500,
        deficitIncurred: 0,
        proportionalPt: 12500,
        isPartial: true,
      })

      const result = await useCase.execute({ ...baseInput, refundedAmount: 1500 })

      expect(result.isPartial).toBe(true)
      const [, action, , , , after] = mockAuditLogService.log.mock.calls[0]
      expect(action).toBe('refund_partial')
      expect(after.paymentStatus).toBe('partial_refunded')
    })

    it('이중 외상 통합 — deficit 발생 시 auditLog action=refund_deficit + after.deficit 가산', async () => {
      // 잔액 10,000 / proportionalPt 25,000 → 환수 10,000 + deficit 15,000
      mockLedger.getBalance.mockResolvedValueOnce({
        free: 0, subscription: 0, gift: 0, charged: 10000,
        total: 10000, deficit: 0, available: 10000,
      })
      mockPaymentRepo.refundPaymentWithPoints.mockResolvedValueOnce({
        actualRefunded: 10000,
        deficitIncurred: 15000,
        proportionalPt: 25000,
        isPartial: false,
      })

      const result = await useCase.execute(baseInput)

      expect(result.deficitIncurred).toBe(15000)
      const [, action, , , before, after] = mockAuditLogService.log.mock.calls[0]
      expect(action).toBe('refund_deficit')
      expect(before.deficit).toBe(0)
      // 이중 외상 통합 — 부족분이 deficit 에 가산되어 다음 충전 시 회수
      expect(after.deficit).toBe(15000)
      expect(after.deficitIncurred).toBe(15000)
    })

    it('부분 환불 + deficit — action=refund_partial_deficit', async () => {
      mockLedger.getBalance.mockResolvedValueOnce({
        free: 0, subscription: 0, gift: 0, charged: 5000,
        total: 5000, deficit: 0, available: 5000,
      })
      mockPaymentRepo.refundPaymentWithPoints.mockResolvedValueOnce({
        actualRefunded: 5000,
        deficitIncurred: 7500,
        proportionalPt: 12500,
        isPartial: true,
      })

      const result = await useCase.execute({ ...baseInput, refundedAmount: 1500 })

      expect(result.isPartial).toBe(true)
      expect(result.deficitIncurred).toBe(7500)
      const [, action] = mockAuditLogService.log.mock.calls[0]
      expect(action).toBe('refund_partial_deficit')
    })
  })

  describe('balanceBefore 조회 분기', () => {
    it('ledger 미주입 + authorRepo 만 — fallback (charged 만 박제)', async () => {
      const ucNoLedger = new RefundPaymentUseCase(
        mockPaymentRepo as never,
        mockAuditLogService as never,
        mockAuthorRepo as never,
      )
      mockPaymentRepo.refundPaymentWithPoints.mockResolvedValueOnce({
        actualRefunded: 25000,
        deficitIncurred: 0,
        proportionalPt: 25000,
        isPartial: false,
      })

      await ucNoLedger.execute(baseInput)

      const [, , , , before] = mockAuditLogService.log.mock.calls[0]
      // fallback — author.credits 만 charged 슬롯에 박제
      expect(before).toEqual(
        expect.objectContaining({
          charged: 25000,
          total: 25000,
          deficit: 0,
        }),
      )
    })

    it('ledger 조회 실패해도 환수 트랜잭션은 진행 (auditLog state 만 미박제)', async () => {
      mockLedger.getBalance.mockRejectedValueOnce(new Error('DB down'))
      mockPaymentRepo.refundPaymentWithPoints.mockResolvedValueOnce({
        actualRefunded: 25000,
        deficitIncurred: 0,
        proportionalPt: 25000,
        isPartial: false,
      })

      const result = await useCase.execute(baseInput)

      expect(result.actualRefunded).toBe(25000)
      // auditLog 호출됐고 state(before/after)는 undefined
      const [, , , , before, after] = mockAuditLogService.log.mock.calls[0]
      expect(before).toBeUndefined()
      expect(after).toBeUndefined()
    })
  })

  describe('에러 처리', () => {
    it('refundPaymentWithPoints throw 시 그대로 위임 (auditLog 미박제)', async () => {
      mockPaymentRepo.refundPaymentWithPoints.mockRejectedValueOnce(
        new Error('Payment not found: pay-1'),
      )

      await expect(useCase.execute(baseInput)).rejects.toThrow('Payment not found')
      expect(mockAuditLogService.log).not.toHaveBeenCalled()
    })

    it('auditLog 실패는 환수 트랜잭션 결과를 무효화하지 않음', async () => {
      mockPaymentRepo.refundPaymentWithPoints.mockResolvedValueOnce({
        actualRefunded: 25000,
        deficitIncurred: 0,
        proportionalPt: 25000,
        isPartial: false,
      })
      mockAuditLogService.log.mockRejectedValueOnce(new Error('audit DB down'))

      const result = await useCase.execute(baseInput)
      expect(result.actualRefunded).toBe(25000)
    })
  })
})
