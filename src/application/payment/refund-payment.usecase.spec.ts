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
  // PAY-P2-4: AuthorRepository mock — beforeState 박제용 잔액 사전 조회
  let mockAuthorRepo: {
    findById: jest.Mock
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
    // PAY-P2-4: 기본 author.credits=100 — beforeState 박제용
    mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'author-1', slug: 'a', name: 'A', email: 'a@a.com',
        role: 'user', credits: 100, plan: 'free', planExpireAt: null, createdAt: new Date(),
      }),
    }
    useCase = new RefundPaymentUseCase(
      mockPaymentRepo as never,
      mockAuditLogService as never,
      mockAuthorRepo as never,
    )
  })

  describe('정상 환수 (Author.credits >= credits, 전액 환불 — PAY-P1-1 회귀 보존)', () => {
    it('credits=50 보유 시 50 decrement + deficitCredits=0 + auditLog action=refund_normal 박제', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 50,
        deficitCredits: 0,
        proportionalCredits: 50,
        isPartial: false,
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

      // AuditLog — 정상 분기 (PAY-P1-1 회귀 보존 + PAY-P2-4 6-arg 호출)
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
          isPartial: false,
          proportionalCredits: 50,
          reason: 'polar_webhook_order.refunded',
          source: 'webhook',
        }),
        // PAY-P2-4: beforeState — author.credits=100 (mock 베이스), paymentStatus='completed'
        { credits: 100, paymentStatus: 'completed' },
        // PAY-P2-4: afterState — credits=100-50=50, status='refunded' (전액), deficit=0
        {
          credits: 50,
          paymentStatus: 'refunded',
          deficitCredits: 0,
          creditsActuallyDeducted: 50,
        },
      )

      // 반환값 검증 — PAY-P2-1 4 필드 확장
      expect(result).toEqual({
        actualDeducted: 50,
        deficitCredits: 0,
        proportionalCredits: 50,
        isPartial: false,
      })
    })

    it('source=manual 시 reason은 그대로 박제되고 auditLog detail.source=manual로 박제', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 30,
        deficitCredits: 0,
        proportionalCredits: 30,
        isPartial: false,
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

  describe('deficit 환수 (Author.credits < credits, 전액 환불 — PAY-P1-1 회귀 보존)', () => {
    it('credits=50 요청 + 잔액 30 시 actualDeducted=30 + deficitCredits=20 + action=refund_deficit', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 30,
        deficitCredits: 20,
        proportionalCredits: 50,
        isPartial: false,
      })

      const result = await useCase.execute(baseInput)

      // refundPaymentAtomically — 요청 인자는 credits=50 그대로 전달 (repo 내부에서 잔액 조회 후 조정)
      expect(mockPaymentRepo.refundPaymentAtomically).toHaveBeenCalledWith(
        expect.objectContaining({ credits: 50 }),
      )

      // AuditLog — deficit 분기 (action 식별자 + detail 박제, PAY-P1-1 회귀 보존)
      // PAY-P2-4: 6-arg 호출 — beforeState/afterState 검증 추가
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'system_refund',
        'refund_deficit',
        'pay-1',
        expect.objectContaining({
          creditsRequested: 50,
          creditsActuallyDeducted: 30,
          deficitCredits: 20,
          isPartial: false,
        }),
        { credits: 100, paymentStatus: 'completed' },
        // afterState: 100 - 30 = 70 잔액, deficit=20
        {
          credits: 70,
          paymentStatus: 'refunded',
          deficitCredits: 20,
          creditsActuallyDeducted: 30,
        },
      )

      // 반환값 — deficit 운영자 추적용
      expect(result.actualDeducted).toBe(30)
      expect(result.deficitCredits).toBe(20)
      expect(result.isPartial).toBe(false)
    })

    it('잔액 0 시 actualDeducted=0 + deficitCredits=credits 전체 + action=refund_deficit', async () => {
      // PAY-P2-4: author.credits=0 (잔액 0 시나리오)
      mockAuthorRepo.findById.mockResolvedValueOnce({
        id: 'author-1', slug: 'a', name: 'A', email: 'a@a.com',
        role: 'user', credits: 0, plan: 'free', planExpireAt: null, createdAt: new Date(),
      })
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 0,
        deficitCredits: 50,
        proportionalCredits: 50,
        isPartial: false,
      })

      const result = await useCase.execute(baseInput)

      expect(result).toEqual({
        actualDeducted: 0,
        deficitCredits: 50,
        proportionalCredits: 50,
        isPartial: false,
      })
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'system_refund',
        'refund_deficit',
        'pay-1',
        expect.objectContaining({ deficitCredits: 50, creditsActuallyDeducted: 0 }),
        { credits: 0, paymentStatus: 'completed' },
        // afterState: 0 - 0 = 0 (deduct 0), deficit=50
        {
          credits: 0,
          paymentStatus: 'refunded',
          deficitCredits: 50,
          creditsActuallyDeducted: 0,
        },
      )
    })
  })

  describe('boundary — 잔액 정확히 같음', () => {
    it('잔액=credits 정확 일치 시 정상 분기 (deficitCredits=0, action=refund_normal)', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 50,
        deficitCredits: 0,
        proportionalCredits: 50,
        isPartial: false,
      })

      await useCase.execute(baseInput)

      // boundary는 정상 분기 — refund_normal 박제 (refund_deficit 아님)
      // PAY-P2-4: 6-arg 호출 (beforeState/afterState 박제) — boundary 잔액=credits 정확 일치
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'system_refund',
        'refund_normal',
        'pay-1',
        expect.objectContaining({ deficitCredits: 0 }),
        { credits: 100, paymentStatus: 'completed' },
        // afterState: 100 - 50 = 50, deficit=0
        {
          credits: 50,
          paymentStatus: 'refunded',
          deficitCredits: 0,
          creditsActuallyDeducted: 50,
        },
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

    it('refundedAmount 0 또는 음수 입력 시 BadRequestException (PAY-P2-1 validation)', async () => {
      await expect(
        useCase.execute({ ...baseInput, refundedAmount: 0 }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        useCase.execute({ ...baseInput, refundedAmount: -100 }),
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
        proportionalCredits: 50,
        isPartial: false,
      })
      mockAuditLogService.log.mockRejectedValueOnce(new Error('audit_log_db_down'))

      // AuditLog 실패는 throw하지 않음 — 환수는 이미 commit됨
      const result = await useCase.execute(baseInput)

      expect(result).toEqual({
        actualDeducted: 50,
        deficitCredits: 0,
        proportionalCredits: 50,
        isPartial: false,
      })
      expect(mockPaymentRepo.refundPaymentAtomically).toHaveBeenCalledTimes(1)
      expect(mockAuditLogService.log).toHaveBeenCalledTimes(1)
    })
  })

  describe('reason 박제 정합', () => {
    it('reason은 입력 그대로 refundPaymentAtomically + auditLog detail에 전달', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 50,
        deficitCredits: 0,
        proportionalCredits: 50,
        isPartial: false,
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

  // PAY-P2-1 부분 환불 (Partial Refund) 신규 spec 6 it
  describe('부분 환불 (PAY-P2-1)', () => {
    it('부분 환불 비율 50% (refundedAmount=2500, payment.amount=5000) — 크레딧 비례 25 차감 + action=refund_partial', async () => {
      // repository가 비율 계산해서 proportionalCredits=25 반환 (Math.floor(50 * 0.5) = 25)
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 25,
        deficitCredits: 0,
        proportionalCredits: 25,
        isPartial: true,
      })

      const result = await useCase.execute({
        ...baseInput,
        refundedAmount: 2500, // 50% 부분 환불
      })

      expect(result.isPartial).toBe(true)
      expect(result.proportionalCredits).toBe(25)
      expect(result.actualDeducted).toBe(25)
      expect(result.deficitCredits).toBe(0)

      // AuditLog action — 부분 환불 정상 (PAY-P2-4: 6-arg 호출 + paymentStatus='partial_refunded')
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'system_refund',
        'refund_partial',
        'pay-1',
        expect.objectContaining({
          refundedAmount: 2500,
          creditsRequested: 50,
          proportionalCredits: 25,
          creditsActuallyDeducted: 25,
          isPartial: true,
        }),
        { credits: 100, paymentStatus: 'completed' },
        // afterState: 100 - 25 = 75, status='partial_refunded' (부분 환불)
        {
          credits: 75,
          paymentStatus: 'partial_refunded',
          deficitCredits: 0,
          creditsActuallyDeducted: 25,
        },
      )
    })

    it('부분 환불 + 잔액 부족 deficit — proportionalCredits=25, 잔액 10 → actualDeducted=10 + deficit=15 + action=refund_partial_deficit', async () => {
      // PAY-P2-4: author.credits=10 (잔액 부족)
      mockAuthorRepo.findById.mockResolvedValueOnce({
        id: 'author-1', slug: 'a', name: 'A', email: 'a@a.com',
        role: 'user', credits: 10, plan: 'free', planExpireAt: null, createdAt: new Date(),
      })
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 10,
        deficitCredits: 15,
        proportionalCredits: 25,
        isPartial: true,
      })

      const result = await useCase.execute({
        ...baseInput,
        refundedAmount: 2500,
      })

      expect(result).toEqual({
        actualDeducted: 10,
        deficitCredits: 15,
        proportionalCredits: 25,
        isPartial: true,
      })

      // action='refund_partial_deficit' (PAY-P2-4: 6-arg + paymentStatus='partial_refunded' + deficit)
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'system_refund',
        'refund_partial_deficit',
        'pay-1',
        expect.objectContaining({
          isPartial: true,
          deficitCredits: 15,
          proportionalCredits: 25,
          creditsActuallyDeducted: 10,
        }),
        { credits: 10, paymentStatus: 'completed' },
        // afterState: 10 - 10 = 0, status='partial_refunded' + deficit=15
        {
          credits: 0,
          paymentStatus: 'partial_refunded',
          deficitCredits: 15,
          creditsActuallyDeducted: 10,
        },
      )
    })

    it('Math.floor 반올림 회귀 — credits=10 + ratio=0.75 (refundedAmount=3750/5000) → 7 차감 (7.5 floor)', async () => {
      // repository가 Math.floor(10 * 0.75) = 7 반환
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 7,
        deficitCredits: 0,
        proportionalCredits: 7,
        isPartial: true,
      })

      const result = await useCase.execute({
        ...baseInput,
        credits: 10,
        refundedAmount: 3750, // 75%
      })

      expect(result.proportionalCredits).toBe(7) // Math.floor(7.5) = 7 (사용자 우호 정책)
      expect(result.actualDeducted).toBe(7)
      expect(result.isPartial).toBe(true)
    })

    it('전액 환불 회귀 보존 — refundedAmount === payment.amount 시 isPartial=false + action=refund_normal', async () => {
      // 회귀 보존: refundedAmount = payment.amount → ratio=1.0 → isPartial=false
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 50,
        deficitCredits: 0,
        proportionalCredits: 50,
        isPartial: false,
      })

      await useCase.execute(baseInput)

      // action은 'refund_normal' (PAY-P1-1 회귀 보존)
      // PAY-P2-4: 6-arg 호출 — 전액 환불 시 paymentStatus='refunded'
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'system_refund',
        'refund_normal',
        'pay-1',
        expect.objectContaining({ isPartial: false }),
        { credits: 100, paymentStatus: 'completed' },
        {
          credits: 50,
          paymentStatus: 'refunded',
          deficitCredits: 0,
          creditsActuallyDeducted: 50,
        },
      )
    })

    it('AuditLog 4 action 식별자 매트릭스 — refund_normal/refund_deficit/refund_partial/refund_partial_deficit 정확 분기', async () => {
      // 매트릭스: (isPartial, deficitCredits>0) 4 조합
      const cases = [
        {
          mock: { actualDeducted: 50, deficitCredits: 0, proportionalCredits: 50, isPartial: false },
          expectedAction: 'refund_normal',
        },
        {
          mock: { actualDeducted: 30, deficitCredits: 20, proportionalCredits: 50, isPartial: false },
          expectedAction: 'refund_deficit',
        },
        {
          mock: { actualDeducted: 25, deficitCredits: 0, proportionalCredits: 25, isPartial: true },
          expectedAction: 'refund_partial',
        },
        {
          mock: { actualDeducted: 10, deficitCredits: 15, proportionalCredits: 25, isPartial: true },
          expectedAction: 'refund_partial_deficit',
        },
      ]

      for (const { mock, expectedAction } of cases) {
        mockAuditLogService.log.mockClear()
        mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce(mock)
        await useCase.execute(baseInput)
        expect(mockAuditLogService.log.mock.calls[0][1]).toBe(expectedAction)
      }
    })

    it('repository validation 실패 (refundedAmount > payment.amount) 시 throw 위임 + auditLog 호출 0회', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockRejectedValueOnce(
        new Error('환불 금액(10000)이 결제 금액(5000)을 초과할 수 없습니다'),
      )

      await expect(
        useCase.execute({ ...baseInput, refundedAmount: 10000 }),
      ).rejects.toThrow('환불 금액(10000)이 결제 금액(5000)을 초과할 수 없습니다')

      expect(mockPaymentRepo.refundPaymentAtomically).toHaveBeenCalledTimes(1)
      expect(mockAuditLogService.log).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // PAY-P2-4: AdminAuditLog beforeState/afterState 박제 (정본: shared-contracts §20)
  // ============================================================================
  describe('PAY-P2-4: beforeState/afterState 분리 박제', () => {
    it('전액 정상 환수 — beforeState credits=100 / afterState credits=50 + paymentStatus=refunded', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 50,
        deficitCredits: 0,
        proportionalCredits: 50,
        isPartial: false,
      })

      await useCase.execute(baseInput)

      // 잔액 사전 조회 1회 (PAY-P2-4 게이트)
      expect(mockAuthorRepo.findById).toHaveBeenCalledTimes(1)
      expect(mockAuthorRepo.findById).toHaveBeenCalledWith('author-1')

      // auditLog.log 6번째 인자 (beforeState)
      const beforeStateArg = mockAuditLogService.log.mock.calls[0][4]
      expect(beforeStateArg).toEqual({ credits: 100, paymentStatus: 'completed' })

      // auditLog.log 7번째 인자 (afterState)
      const afterStateArg = mockAuditLogService.log.mock.calls[0][5]
      expect(afterStateArg).toEqual({
        credits: 50,
        paymentStatus: 'refunded',
        deficitCredits: 0,
        creditsActuallyDeducted: 50,
      })
    })

    it('전액 deficit 환수 — afterState credits=0 + deficitCredits=20', async () => {
      mockAuthorRepo.findById.mockResolvedValueOnce({
        id: 'author-1', slug: 'a', name: 'A', email: 'a@a.com',
        role: 'user', credits: 30, plan: 'free', planExpireAt: null, createdAt: new Date(),
      })
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 30,
        deficitCredits: 20,
        proportionalCredits: 50,
        isPartial: false,
      })

      await useCase.execute(baseInput)

      const beforeStateArg = mockAuditLogService.log.mock.calls[0][4]
      const afterStateArg = mockAuditLogService.log.mock.calls[0][5]
      expect(beforeStateArg).toEqual({ credits: 30, paymentStatus: 'completed' })
      expect(afterStateArg).toEqual({
        credits: 0, // 30 - 30 = 0
        paymentStatus: 'refunded',
        deficitCredits: 20,
        creditsActuallyDeducted: 30,
      })
    })

    it('부분 정상 환불 — afterState paymentStatus=partial_refunded', async () => {
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 25,
        deficitCredits: 0,
        proportionalCredits: 25,
        isPartial: true,
      })

      await useCase.execute({ ...baseInput, refundedAmount: 2500 })

      const afterStateArg = mockAuditLogService.log.mock.calls[0][5]
      expect(afterStateArg).toEqual({
        credits: 75, // 100 - 25
        paymentStatus: 'partial_refunded',
        deficitCredits: 0,
        creditsActuallyDeducted: 25,
      })
    })

    it('부분 deficit 환불 — afterState paymentStatus=partial_refunded + deficit=15', async () => {
      mockAuthorRepo.findById.mockResolvedValueOnce({
        id: 'author-1', slug: 'a', name: 'A', email: 'a@a.com',
        role: 'user', credits: 10, plan: 'free', planExpireAt: null, createdAt: new Date(),
      })
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 10,
        deficitCredits: 15,
        proportionalCredits: 25,
        isPartial: true,
      })

      await useCase.execute({ ...baseInput, refundedAmount: 2500 })

      const beforeStateArg = mockAuditLogService.log.mock.calls[0][4]
      const afterStateArg = mockAuditLogService.log.mock.calls[0][5]
      expect(beforeStateArg).toEqual({ credits: 10, paymentStatus: 'completed' })
      expect(afterStateArg).toEqual({
        credits: 0, // 10 - 10 = 0
        paymentStatus: 'partial_refunded',
        deficitCredits: 15,
        creditsActuallyDeducted: 10,
      })
    })

    it('authorRepo 미주입 시 beforeState/afterState 박제 skip (BACKWARD COMPATIBLE)', async () => {
      // authorRepo null로 useCase 재생성
      const useCaseNoAuthor = new RefundPaymentUseCase(
        mockPaymentRepo as never,
        mockAuditLogService as never,
        null,
      )
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 50,
        deficitCredits: 0,
        proportionalCredits: 50,
        isPartial: false,
      })

      await useCaseNoAuthor.execute(baseInput)

      // 잔액 조회는 호출되지 않음 (authorRepo null)
      expect(mockAuthorRepo.findById).not.toHaveBeenCalled()

      // auditLog.log 호출 시 5/6번째 인자는 undefined (회귀 보존)
      expect(mockAuditLogService.log.mock.calls[0][4]).toBeUndefined()
      expect(mockAuditLogService.log.mock.calls[0][5]).toBeUndefined()
    })

    it('잔액 사전 조회 실패 시 beforeState/afterState 박제 skip + 환수는 그대로 진행 (회귀 보존)', async () => {
      mockAuthorRepo.findById.mockRejectedValueOnce(new Error('db_unreachable'))
      mockPaymentRepo.refundPaymentAtomically.mockResolvedValueOnce({
        actualDeducted: 50,
        deficitCredits: 0,
        proportionalCredits: 50,
        isPartial: false,
      })

      const result = await useCase.execute(baseInput)

      // 환수는 성공
      expect(result.actualDeducted).toBe(50)

      // auditLog.log 호출 시 beforeState/afterState undefined
      expect(mockAuditLogService.log.mock.calls[0][4]).toBeUndefined()
      expect(mockAuditLogService.log.mock.calls[0][5]).toBeUndefined()
    })
  })
})
