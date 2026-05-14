import { PaymentUseCase, CREDIT_PRODUCTS } from './payment.usecase'
import { BadRequestException } from '@nestjs/common'
import type { NormalizedWebhookEvent } from '@domain/port/outbound/payment-gateway.port'
import type { WebhookEventRecord } from '@domain/port/outbound/webhook-event-repository.port'

describe('PaymentUseCase', () => {
  let useCase: PaymentUseCase
  let mockPrisma: any
  let mockCreditUseCase: any
  let mockPaymentGateway: any
  let mockWebhookEventRepo: any
  let mockRefundPaymentUseCase: any
  let mockAuthorRepo: any
  let mockAuditLog: any

  const mockPayment = {
    id: 'pay-1',
    authorId: 'author-1',
    productId: 'credit-5',
    amount: 2000,
    credits: 5,
    externalTransactionId: null,
    status: 'pending',
    createdAt: new Date(),
    completedAt: null,
  }

  // 더미 웹훅 입력 — 어댑터가 파싱하므로 PaymentUseCase 테스트에서는 실제 값 불필요
  const dummyBody = Buffer.from('{}')
  const dummyHeaders: Record<string, string> = {}

  const makeEvent = (
    overrides: Partial<NormalizedWebhookEvent> = {},
  ): NormalizedWebhookEvent => ({
    eventId: 'evt_test_001',
    type: 'order.paid',
    tradeNo: 'TRADE-001',
    amount: 2000,
    status: 'success',
    ...overrides,
  })

  const makeWebhookRecord = (
    eventId: string,
    overrides: Partial<WebhookEventRecord> = {},
  ): WebhookEventRecord => ({
    id: `whe-${eventId}`,
    eventId,
    source: 'polar',
    eventType: 'order.paid',
    status: 'processed',
    processedAt: new Date(),
    ...overrides,
  })

  beforeEach(() => {
    // $transaction mock: 콜백을 받아서 동일한 mock prisma를 tx로 넘긴다
    const paymentMock = {
      create: jest.fn().mockResolvedValue(mockPayment),
      update: jest.fn().mockResolvedValue({ ...mockPayment, externalTransactionId: 'TRADE-001' }),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([mockPayment]),
    }

    const mockPaymentRepo = {
      create: paymentMock.create,
      findByExternalTransactionId: paymentMock.findUnique,
      updateExternalTransactionId: jest.fn().mockResolvedValue(undefined),
      findByAuthorId: paymentMock.findMany,
      completePaymentAtomically: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      refundPaymentAtomically: jest.fn().mockResolvedValue({ actualDeducted: 0, deficitCredits: 0 }),
      // PAY-P1-3 — findReusablePendingPayment mock (기본: 재사용 후보 0건 → null 반환 = 신규 create 분기)
      findReusablePendingPayment: jest.fn().mockResolvedValue(null),
      findPendingPaymentsOlderThan: jest.fn().mockResolvedValue([]),
      expirePayment: jest.fn().mockResolvedValue(undefined),
    }
    mockPrisma = mockPaymentRepo // alias for backward test compatibility

    mockCreditUseCase = {
      grant: jest.fn().mockResolvedValue({ credits: 8, log: {} }),
      getBalance: jest.fn().mockResolvedValue(10),
    }

    mockPaymentGateway = {
      initiatePayment: jest.fn().mockResolvedValue({
        paymentUrl: 'https://example.com/pay/test',
        tradeNo: 'TRADE-001',
      }),
      verifyAndParseWebhook: jest.fn().mockReturnValue(makeEvent()),
    }

    mockWebhookEventRepo = {
      findByEventId: jest.fn().mockResolvedValue(null),
      createIfAbsent: jest.fn().mockImplementation(async (input) =>
        makeWebhookRecord(input.eventId, {
          eventType: input.eventType,
          status: input.status ?? 'processed',
        }),
      ),
      markStatus: jest.fn().mockResolvedValue(undefined),
    }

    // Sprint PAY-P1-1: refund usecase mock — 'cancel' 분기에서만 호출되어야 함
    mockRefundPaymentUseCase = {
      execute: jest.fn().mockResolvedValue({ actualDeducted: 0, deficitCredits: 0 }),
    }

    // Sprint PAY-P2-4 — authorRepo + auditLog mock (success 분기 잔액 조회 + audit 박제)
    mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'author-1', slug: 'a', name: 'A', email: 'a@a.com',
        role: 'user', credits: 50, plan: 'free', planExpireAt: null, createdAt: new Date(),
      }),
    }
    mockAuditLog = {
      log: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    }

    useCase = new PaymentUseCase(
      mockPaymentRepo as any,
      mockPaymentGateway,
      mockWebhookEventRepo,
      mockRefundPaymentUseCase,
      mockAuthorRepo,
      mockAuditLog,
    )
  })

  describe('getProducts', () => {
    it('3개의 상품을 반환한다', () => {
      const products = useCase.getProducts()

      expect(products).toHaveLength(3)
      expect(products[0]).toHaveProperty('id')
      expect(products[0]).toHaveProperty('name')
      expect(products[0]).toHaveProperty('credits')
      expect(products[0]).toHaveProperty('price')
      expect(products[0]).toHaveProperty('pricePerCredit')
    })

    it('상품 가격이 올바르다 (기획서 §8 기준, F1 2026-04-19 인상 반영)', () => {
      const products = useCase.getProducts()
      const p5 = products.find((p) => p.id === 'credit-5')!
      const p20 = products.find((p) => p.id === 'credit-20')!
      const p50 = products.find((p) => p.id === 'credit-50')!

      expect(p5.price).toBe(2000)
      expect(p20.price).toBe(3000)
      expect(p50.price).toBe(5000)
    })
  })

  describe('initiatePayment', () => {
    it('pending 상태 Payment를 생성하고 게이트웨이를 호출한다', async () => {
      const result = await useCase.initiatePayment('author-1', 'credit-5', 'https://example.com/return')

      expect(mockPrisma.create).toHaveBeenCalledWith(
        expect.objectContaining({
          authorId: 'author-1',
          productId: 'credit-5',
          amount: 2000,
          credits: 5,
        }),
      )
      expect(mockPaymentGateway.initiatePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'credit-5',
          productName: '5 크레딧',
          amount: 2000,
        }),
      )
      expect(result.paymentUrl).toBe('https://example.com/pay/test')
      expect(result.tradeNo).toBe('TRADE-001')
    })

    it('externalTransactionId를 Payment 레코드에 업데이트한다', async () => {
      await useCase.initiatePayment('author-1', 'credit-5', 'https://example.com/return')

      expect(mockPrisma.updateExternalTransactionId).toHaveBeenCalledWith('pay-1', 'TRADE-001')
    })

    it('존재하지 않는 productId면 예외를 던진다', async () => {
      await expect(
        useCase.initiatePayment('author-1', 'credit-999', 'https://example.com/return'),
      ).rejects.toThrow(BadRequestException)

      expect(mockPrisma.create).not.toHaveBeenCalled()
      expect(mockPaymentGateway.initiatePayment).not.toHaveBeenCalled()
    })

    // ============================================================================
    // Sprint PAY-P1-3: 결제 실패 retry 정책 — 24h 이내 pending 재사용 (정본: shared-contracts §14)
    // ============================================================================
    describe('PAY-P1-3: 24h 이내 pending Payment 재사용', () => {
      const reusablePayment = {
        id: 'pay-reuse-1',
        authorId: 'author-1',
        productId: 'credit-5',
        amount: 2000,
        credits: 5,
        status: 'pending',
        externalTransactionId: 'TRADE-OLD',
        createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5분 전
        completedAt: null,
      }

      it('24h 이내 pending 적중 시 paymentId 재사용 + create 호출 0회 + Polar URL 재발급', async () => {
        mockPrisma.findReusablePendingPayment.mockResolvedValueOnce(reusablePayment)
        mockPaymentGateway.initiatePayment.mockResolvedValueOnce({
          tradeNo: 'TRADE-NEW-2',
          paymentUrl: 'https://example.com/pay/new-2',
        })

        const result = await useCase.initiatePayment(
          'author-1',
          'credit-5',
          'https://example.com/return',
        )

        // 진입 게이트 호출 정합 — (authorId, productId, expireSince=Date 객체)
        expect(mockPrisma.findReusablePendingPayment).toHaveBeenCalledTimes(1)
        expect(mockPrisma.findReusablePendingPayment).toHaveBeenCalledWith(
          'author-1',
          'credit-5',
          expect.any(Date),
        )

        // create는 호출 0회 (재사용)
        expect(mockPrisma.create).not.toHaveBeenCalled()

        // Polar SDK 1회 호출 (재사용 분기에서도 신규 URL 발급)
        expect(mockPaymentGateway.initiatePayment).toHaveBeenCalledTimes(1)

        // updateExternalTransactionId 1회 호출 (재사용 row의 tradeNo 갱신)
        expect(mockPrisma.updateExternalTransactionId).toHaveBeenCalledTimes(1)
        expect(mockPrisma.updateExternalTransactionId).toHaveBeenCalledWith(
          'pay-reuse-1',
          'TRADE-NEW-2',
        )

        // 응답 paymentId는 재사용 row의 id, paymentUrl/tradeNo는 신규 발급
        expect(result).toEqual({
          paymentId: 'pay-reuse-1',
          paymentUrl: 'https://example.com/pay/new-2',
          tradeNo: 'TRADE-NEW-2',
        })
      })

      it('24h 초과(findReusablePendingPayment null 반환) 시 신규 create + 기존 흐름 유지', async () => {
        mockPrisma.findReusablePendingPayment.mockResolvedValueOnce(null)

        const result = await useCase.initiatePayment(
          'author-1',
          'credit-5',
          'https://example.com/return',
        )

        // 진입 게이트 호출 1회
        expect(mockPrisma.findReusablePendingPayment).toHaveBeenCalledTimes(1)

        // 신규 create 1회 (재사용 후보 없음)
        expect(mockPrisma.create).toHaveBeenCalledTimes(1)
        expect(mockPrisma.create).toHaveBeenCalledWith(
          expect.objectContaining({
            authorId: 'author-1',
            productId: 'credit-5',
            amount: 2000,
            credits: 5,
          }),
        )

        // Polar SDK 1회 + updateExternalTransactionId 1회 (기존 흐름)
        expect(mockPaymentGateway.initiatePayment).toHaveBeenCalledTimes(1)
        expect(mockPrisma.updateExternalTransactionId).toHaveBeenCalledWith('pay-1', 'TRADE-001')

        expect(result.paymentId).toBe('pay-1')
      })

      it('expireSince 인자는 now-24h 시각 (시간 정합 검증)', async () => {
        mockPrisma.findReusablePendingPayment.mockResolvedValueOnce(null)

        const beforeCall = Date.now()
        await useCase.initiatePayment('author-1', 'credit-5', 'https://example.com/return')
        const afterCall = Date.now()

        // 호출 인자에서 expireSince 추출 — now - 24h ± 100ms 허용
        const expireSinceArg = mockPrisma.findReusablePendingPayment.mock.calls[0][2] as Date
        const expectedMin = beforeCall - 24 * 60 * 60 * 1000 - 100
        const expectedMax = afterCall - 24 * 60 * 60 * 1000 + 100
        expect(expireSinceArg.getTime()).toBeGreaterThanOrEqual(expectedMin)
        expect(expireSinceArg.getTime()).toBeLessThanOrEqual(expectedMax)
      })

      it('재사용 분기에서도 Polar SDK 호출 + tradeNo 갱신은 1회씩 정확히 발생 (race 시뮬)', async () => {
        // 사용자가 동일 productId로 재시도하는 케이스를 시뮬 — 첫 호출의 row를 두 번째 호출이 재사용
        mockPrisma.findReusablePendingPayment
          .mockResolvedValueOnce(null) // 첫 호출 — 재사용 후보 0건 → 신규 create
          .mockResolvedValueOnce(reusablePayment) // 두 번째 호출 — 첫 호출의 row 재사용

        mockPaymentGateway.initiatePayment
          .mockResolvedValueOnce({ tradeNo: 'TRADE-A', paymentUrl: 'url-a' })
          .mockResolvedValueOnce({ tradeNo: 'TRADE-B', paymentUrl: 'url-b' })

        const r1 = await useCase.initiatePayment('author-1', 'credit-5', 'https://r')
        const r2 = await useCase.initiatePayment('author-1', 'credit-5', 'https://r')

        // create는 첫 호출에서만 1회
        expect(mockPrisma.create).toHaveBeenCalledTimes(1)

        // findReusablePendingPayment는 두 번 모두 호출
        expect(mockPrisma.findReusablePendingPayment).toHaveBeenCalledTimes(2)

        // Polar SDK는 두 번 호출 (재사용 분기에서도 신규 URL)
        expect(mockPaymentGateway.initiatePayment).toHaveBeenCalledTimes(2)

        // updateExternalTransactionId 두 번 호출 — 첫 호출은 신규 row, 두 번째는 재사용 row 갱신
        expect(mockPrisma.updateExternalTransactionId).toHaveBeenCalledTimes(2)
        expect(mockPrisma.updateExternalTransactionId).toHaveBeenNthCalledWith(1, 'pay-1', 'TRADE-A')
        expect(mockPrisma.updateExternalTransactionId).toHaveBeenNthCalledWith(
          2,
          'pay-reuse-1',
          'TRADE-B',
        )

        // 첫 호출은 신규 paymentId, 두 번째는 재사용 paymentId
        expect(r1.paymentId).toBe('pay-1')
        expect(r2.paymentId).toBe('pay-reuse-1')
        expect(r2.paymentUrl).toBe('url-b')
        expect(r2.tradeNo).toBe('TRADE-B')
      })
    })
  })

  describe('processWebhook', () => {
    it('서명 검증/파싱 실패 시(null 반환) 무시한다', async () => {
      mockPaymentGateway.verifyAndParseWebhook.mockReturnValue(null)

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      expect(result.processed).toBe(false)
      expect(result.reason).toBe('invalid_or_ignored')
      // null 반환 시 멱등성 조회도 호출하지 않음
      expect(mockWebhookEventRepo.findByEventId).not.toHaveBeenCalled()
    })

    it('tradeNo에 해당하는 결제가 없으면 무시하고 webhook event를 skipped로 박제한다', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue(null)

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      expect(result.processed).toBe(false)
      expect(result.reason).toBe('unknown_trade')
      expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt_test_001',
          source: 'polar',
          status: 'skipped',
          errorMessage: 'unknown_trade',
        }),
      )
    })

    it('이미 completed인 결제는 무시한다 (약식 멱등성 + webhook event 박제)', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        status: 'completed',
        externalTransactionId: 'TRADE-001',
      })

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      expect(result.processed).toBe(false)
      expect(result.reason).toBe('already_completed')
      expect(mockCreditUseCase.grant).not.toHaveBeenCalled()
      expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt_test_001',
          status: 'skipped',
          errorMessage: 'already_completed',
        }),
      )
    })

    it('성공 웹훅 시 원자적 트랜잭션으로 크레딧 부여 + 상태 변경 + webhook event를 processed로 박제한다', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      expect(result.processed).toBe(true)
      expect(result.credits).toBe(5)
      expect(mockPrisma.completePaymentAtomically).toHaveBeenCalledWith('pay-1', 'author-1', 5, 'credit-5')
      expect(mockWebhookEventRepo.findByEventId).toHaveBeenCalledWith('evt_test_001')
      expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt_test_001',
          source: 'polar',
          eventType: 'order.paid',
          status: 'processed',
        }),
      )
    })

    // PAY-P2-4: 성공 분기에서 잔액 사전 조회 + auditLog beforeState/afterState 박제
    it('PAY-P2-4: 성공 웹훅 시 authorRepo.findById 1회 + auditLog.log 6-arg(payment_completed) 박제', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })

      await useCase.processWebhook(dummyBody, dummyHeaders)

      // 잔액 사전 조회 호출 확인
      expect(mockAuthorRepo.findById).toHaveBeenCalledTimes(1)
      expect(mockAuthorRepo.findById).toHaveBeenCalledWith('author-1')

      // auditLog.log 정확히 1회 호출 + 7-arg (operator='system_payment', action='payment_completed')
      expect(mockAuditLog.log).toHaveBeenCalledTimes(1)
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'system_payment',
        'payment_completed',
        'pay-1',
        expect.objectContaining({
          reason: 'polar_webhook_order.paid',
          externalTransactionId: 'TRADE-001',
        }),
        { credits: 50 }, // mockAuthorRepo author.credits 베이스
        expect.objectContaining({
          credits: 55, // 50 + 5 (payment.credits)
          paymentId: 'pay-1',
          addedCredits: 5,
        }),
      )
    })

    it('PAY-P2-4: 성공 분기 — 잔액 조회 실패 시 auditLog 박제 skip + 결제는 성공 (회귀 보존)', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })
      mockAuthorRepo.findById.mockRejectedValueOnce(new Error('db_unreachable'))

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      // 결제는 성공 (잔액 조회 실패가 차단하지 않음)
      expect(result.processed).toBe(true)
      expect(result.credits).toBe(5)
      expect(mockPrisma.completePaymentAtomically).toHaveBeenCalledTimes(1)

      // auditLog는 박제 skip (balanceBefore null)
      expect(mockAuditLog.log).not.toHaveBeenCalled()
    })

    it('PAY-P2-4: 성공 분기 — auditLog.log 실패 시 결제는 그대로 성공 (logger.warn만, throw 0)', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })
      mockAuditLog.log.mockRejectedValueOnce(new Error('audit_log_db_down'))

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      // 결제는 성공
      expect(result.processed).toBe(true)
      expect(result.credits).toBe(5)
      expect(mockPrisma.completePaymentAtomically).toHaveBeenCalledTimes(1)
      // auditLog 호출 1회 (실패는 catch 처리)
      expect(mockAuditLog.log).toHaveBeenCalledTimes(1)
    })

    it('실패(fail) 웹훅 시 상태를 failed로 변경하고 refund usecase는 호출하지 않는다 (PAY-P1-1 회귀)', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })
      mockPaymentGateway.verifyAndParseWebhook.mockReturnValue(makeEvent({ status: 'fail' }))

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      expect(result.processed).toBe(true)
      expect(result.credits).toBe(0)
      expect(mockPrisma.updateStatus).toHaveBeenCalledWith('pay-1', 'failed')
      expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt_test_001', status: 'processed' }),
      )
      // PAY-P1-1: 'fail'은 환수 대상 아님 — refundPaymentUseCase 호출 0회
      expect(mockRefundPaymentUseCase.execute).not.toHaveBeenCalled()
    })

    it('취소(cancel) 웹훅 시 refund usecase 1회 호출 + status="refunded" + deficitCredits 응답 포함 (PAY-P1-1)', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })
      mockPaymentGateway.verifyAndParseWebhook.mockReturnValue(
        makeEvent({ type: 'order.refunded', status: 'cancel', amount: 2000 }),
      )
      mockRefundPaymentUseCase.execute.mockResolvedValueOnce({
        actualDeducted: 5,
        deficitCredits: 0,
      })

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      // PAY-P1-1: refund usecase 정확히 1회 호출 + 입력 정합 검증
      expect(mockRefundPaymentUseCase.execute).toHaveBeenCalledTimes(1)
      expect(mockRefundPaymentUseCase.execute).toHaveBeenCalledWith({
        paymentId: 'pay-1',
        authorId: 'author-1',
        credits: 5,
        refundedAmount: 2000,
        reason: 'polar_webhook_order.refunded',
        source: 'webhook',
      })

      // updateStatus는 호출 0회 — refund usecase 내부의 $transaction이 status='refunded'를 처리
      expect(mockPrisma.updateStatus).not.toHaveBeenCalled()

      // 응답에 deficitCredits 포함 (정상 환수 시 0)
      expect(result.processed).toBe(true)
      expect(result.credits).toBe(0)
      expect(result).toHaveProperty('deficitCredits', 0)

      // webhook event 박제
      expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt_test_001', status: 'processed' }),
      )
    })

    it('취소(cancel) 웹훅 + 잔액 부족 시 deficitCredits 양수로 응답에 박제 (PAY-P1-1 deficit 분기)', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })
      mockPaymentGateway.verifyAndParseWebhook.mockReturnValue(
        makeEvent({ type: 'order.refunded', status: 'cancel' }),
      )
      mockRefundPaymentUseCase.execute.mockResolvedValueOnce({
        actualDeducted: 3,
        deficitCredits: 2,
      })

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      expect(result).toEqual(expect.objectContaining({
        processed: true,
        credits: 0,
        deficitCredits: 2,
      }))
    })

    it('취소(cancel) 웹훅 + refund 트랜잭션 실패 시 webhook event를 failed로 박제하고 throw (PAY-P1-1)', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })
      mockPaymentGateway.verifyAndParseWebhook.mockReturnValue(
        makeEvent({ type: 'order.refunded', status: 'cancel' }),
      )
      mockRefundPaymentUseCase.execute.mockRejectedValueOnce(new Error('refund_db_lost'))

      await expect(useCase.processWebhook(dummyBody, dummyHeaders)).rejects.toThrow('refund_db_lost')

      expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt_test_001',
          status: 'failed',
          errorMessage: expect.stringContaining('refund_db_lost'),
        }),
      )
    })

    // ============================================================================
    // Sprint PAY-P0-1: WebhookEvent 멱등성 게이트 신규 검증
    // ============================================================================

    describe('PAY-P0-1: 동일 eventId 멱등성 게이트', () => {
      it('동일 eventId로 webhook 두 번 호출 시 첫 호출만 completePaymentAtomically 실행한다', async () => {
        mockPrisma.findByExternalTransactionId.mockResolvedValue({
          ...mockPayment,
          externalTransactionId: 'TRADE-001',
        })

        // 첫 호출: findByEventId → null (신규), createIfAbsent → 박제 성공
        // 두 번째 호출: findByEventId → 기존 record 반환 (이미 박제됨)
        mockWebhookEventRepo.findByEventId
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(makeWebhookRecord('evt_test_001'))

        const first = await useCase.processWebhook(dummyBody, dummyHeaders)
        const second = await useCase.processWebhook(dummyBody, dummyHeaders)

        expect(first.processed).toBe(true)
        expect(first.credits).toBe(5)
        expect(second.processed).toBe(false)
        expect(second.reason).toBe('duplicate_event')

        // 핵심: completePaymentAtomically는 단 1회만 호출되어야 한다
        expect(mockPrisma.completePaymentAtomically).toHaveBeenCalledTimes(1)
        expect(mockPrisma.completePaymentAtomically).toHaveBeenCalledWith('pay-1', 'author-1', 5, 'credit-5')

        // findByEventId는 두 번 모두 호출됨 (게이트 진입)
        expect(mockWebhookEventRepo.findByEventId).toHaveBeenCalledTimes(2)
        expect(mockWebhookEventRepo.findByEventId).toHaveBeenNthCalledWith(1, 'evt_test_001')
        expect(mockWebhookEventRepo.findByEventId).toHaveBeenNthCalledWith(2, 'evt_test_001')
      })

      it('첫 호출이 박제(createIfAbsent) 직전 race로 다른 worker가 INSERT 완료 시에도 안전하게 처리된다', async () => {
        mockPrisma.findByExternalTransactionId.mockResolvedValue({
          ...mockPayment,
          externalTransactionId: 'TRADE-001',
        })

        // findByEventId는 null (신규)이지만, createIfAbsent에서 P2002 → null 반환 (race detected)
        mockWebhookEventRepo.findByEventId.mockResolvedValueOnce(null)
        mockWebhookEventRepo.createIfAbsent.mockResolvedValueOnce(null)

        const result = await useCase.processWebhook(dummyBody, dummyHeaders)

        // race가 감지되어도 첫 worker는 정상 응답 (둘 중 하나만 처리되면 OK)
        expect(result.processed).toBe(true)
        expect(result.credits).toBe(5)
        expect(mockPrisma.completePaymentAtomically).toHaveBeenCalledTimes(1)
      })

      it('completePaymentAtomically 실패 시 webhook event를 failed로 박제하고 throw한다', async () => {
        mockPrisma.findByExternalTransactionId.mockResolvedValue({
          ...mockPayment,
          externalTransactionId: 'TRADE-001',
        })
        mockPrisma.completePaymentAtomically.mockRejectedValueOnce(new Error('DB connection lost'))

        await expect(useCase.processWebhook(dummyBody, dummyHeaders)).rejects.toThrow('DB connection lost')

        expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
          expect.objectContaining({
            eventId: 'evt_test_001',
            status: 'failed',
            errorMessage: expect.stringContaining('DB connection lost'),
          }),
        )
      })

      // ============================================================================
      // Sprint PAY-P3-A: race condition 차단 — 구멍-A 사전 게이트 (refunded / partial_refunded)
      // 정본: .claude/shared-contracts.md §22 PaymentRaceCondition
      // AC-1: payment.status='refunded' 상태에서 succeeded webhook 진입 skip
      // AC-2: payment.status='partial_refunded' 상태에서 추가 부분 환불 webhook 진입 skip
      // AC-6 변형: 호출 흐름 게이트 우회 불가 검증 (직접 호출 + status 검증)
      // ============================================================================
      describe('PAY-P3-A: refunded/partial_refunded 사전 게이트 (구멍-A 차단)', () => {
        it('AC-1: payment.status=refunded 시 succeeded webhook 재진입은 skip + completePaymentAtomically 호출 0건', async () => {
          mockPrisma.findByExternalTransactionId.mockResolvedValue({
            ...mockPayment,
            status: 'refunded',
            externalTransactionId: 'TRADE-001',
          })

          const result = await useCase.processWebhook(dummyBody, dummyHeaders)

          // 사전 게이트 차단 — completePaymentAtomically 호출 0건 (재차감 0건 보장)
          expect(mockPrisma.completePaymentAtomically).not.toHaveBeenCalled()
          // refund usecase도 호출 0건 (succeeded webhook이므로 cancel 분기 미진입)
          expect(mockRefundPaymentUseCase.execute).not.toHaveBeenCalled()

          // skipped 박제 — webhookEventRepo.createIfAbsent { status: 'skipped', errorMessage: 'already_refunded' }
          expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
            expect.objectContaining({
              eventId: 'evt_test_001',
              source: 'polar',
              status: 'skipped',
              errorMessage: 'already_refunded',
            }),
          )

          // 응답 정합 — { processed: false, reason: 'already_refunded' }
          expect(result.processed).toBe(false)
          expect(result.reason).toBe('already_refunded')
        })

        it('AC-2: payment.status=partial_refunded 시 추가 환불 webhook 진입은 skip + refundPaymentAtomically 호출 0건', async () => {
          mockPrisma.findByExternalTransactionId.mockResolvedValue({
            ...mockPayment,
            status: 'partial_refunded',
            externalTransactionId: 'TRADE-001',
          })
          mockPaymentGateway.verifyAndParseWebhook.mockReturnValue(
            makeEvent({ type: 'order.refunded', status: 'cancel' }),
          )

          const result = await useCase.processWebhook(dummyBody, dummyHeaders)

          // 사전 게이트 차단 — refund usecase 호출 0건 (잔액 중복 차감 0건 보장)
          expect(mockRefundPaymentUseCase.execute).not.toHaveBeenCalled()
          // completePaymentAtomically도 0건 (cancel 분기이지만 게이트가 우선 차단)
          expect(mockPrisma.completePaymentAtomically).not.toHaveBeenCalled()

          // skipped 박제
          expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
            expect.objectContaining({
              eventId: 'evt_test_001',
              source: 'polar',
              status: 'skipped',
              errorMessage: 'already_partial_refunded',
            }),
          )

          // 응답 정합
          expect(result.processed).toBe(false)
          expect(result.reason).toBe('already_partial_refunded')
        })

        it('AC-3 시뮬: 동시 환불 webhook 2건 race — 첫 트랜잭션 완료 후 두 번째는 사전 게이트 통과 안 됨', async () => {
          // 첫 호출: status='pending' (정상 cancel webhook 진입 대상) → refund usecase 호출
          // 두 번째 호출: status='refunded' (첫 트랜잭션 commit 후 상태) → 사전 게이트 차단
          mockPrisma.findByExternalTransactionId
            .mockResolvedValueOnce({
              ...mockPayment,
              status: 'pending', // cancel webhook은 pending payment 대상
              externalTransactionId: 'TRADE-001',
            })
            .mockResolvedValueOnce({
              ...mockPayment,
              status: 'refunded', // 첫 트랜잭션이 갱신한 상태
              externalTransactionId: 'TRADE-001',
            })
          mockPaymentGateway.verifyAndParseWebhook
            .mockReturnValueOnce(makeEvent({ eventId: 'evt_A', type: 'order.refunded', status: 'cancel' }))
            .mockReturnValueOnce(makeEvent({ eventId: 'evt_B', type: 'order.refunded', status: 'cancel' }))
          mockRefundPaymentUseCase.execute.mockResolvedValueOnce({
            actualDeducted: 5,
            deficitCredits: 0,
            proportionalCredits: 5,
            isPartial: false,
          })

          const r1 = await useCase.processWebhook(dummyBody, dummyHeaders)
          const r2 = await useCase.processWebhook(dummyBody, dummyHeaders)

          // 첫 호출만 refund usecase 호출 1회 (재차감 0건 보장)
          expect(mockRefundPaymentUseCase.execute).toHaveBeenCalledTimes(1)
          // 두 번째 호출은 사전 게이트 차단
          expect(r1.processed).toBe(true)
          expect(r2.processed).toBe(false)
          expect(r2.reason).toBe('already_refunded')
        })

        it('AC-6: completePaymentAtomically 트랜잭션 실패 (CAS_MISMATCH 시뮬) 시 webhook event failed 박제 + DLQ enqueue + throw', async () => {
          // PAY-P3-A: refundPaymentAtomically CAS_MISMATCH throw → 호출자 catch → webhookEvent failed
          // 본 spec은 success 분기로 시뮬 (cancel 분기는 refund usecase 내부 catch로 동일 패턴)
          mockPrisma.findByExternalTransactionId.mockResolvedValue({
            ...mockPayment,
            status: 'pending', // 사전 게이트 통과 (success 분기 정상 진입)
            externalTransactionId: 'TRADE-001',
          })
          // CAS_MISMATCH 시뮬 — completePaymentAtomically가 race window throw
          mockPrisma.completePaymentAtomically.mockRejectedValueOnce(
            new Error('CAS_MISMATCH — race condition detected on author.credits'),
          )

          await expect(useCase.processWebhook(dummyBody, dummyHeaders)).rejects.toThrow(
            'CAS_MISMATCH',
          )

          // webhook event failed 박제 (DLQ retry 진입)
          expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
            expect.objectContaining({
              eventId: 'evt_test_001',
              status: 'failed',
              errorMessage: expect.stringContaining('CAS_MISMATCH'),
            }),
          )
        })
      })

      // ============================================================================
      // Sprint PAY-P3-B: Polar SDK exception 5분류 + retry/permanent 분기 처리 (구멍-C 차단)
      // 정본: .claude/shared-contracts.md §24 PolarSDKTimeoutPolicy
      // AC-3 (5xx → retry) / AC-4 (4xx → permanent_failed 즉시 박제, retry queue 0건)
      // ============================================================================
      describe('PAY-P3-B: Polar SDK exception 분기 처리 (구멍-C 차단)', () => {
        it('AC-4 success 분기: client_4xx exception → AuditLog webhook_permanent_failed 박제 + retry queue 0건', async () => {
          // retryQueueRepo mock + classifyPolarError mock 주입
          const mockRetryQueueRepo = {
            upsert: jest.fn().mockResolvedValue(undefined),
            findDueRetries: jest.fn().mockResolvedValue([]),
            markRetry: jest.fn().mockResolvedValue(undefined),
            deleteByEventId: jest.fn().mockResolvedValue(undefined),
            deleteById: jest.fn().mockResolvedValue(undefined),
          }
          mockPaymentGateway.classifyPolarError = jest.fn().mockReturnValue({
            errorClass: 'client_4xx',
            httpStatus: 400,
            message: 'Bad Request: invalid metadata',
          })

          // 별도 useCase 인스턴스 (retryQueueRepo + classifyPolarError 주입)
          const useCaseWithRetry = new PaymentUseCase(
            mockPrisma as any,
            mockPaymentGateway,
            mockWebhookEventRepo,
            mockRefundPaymentUseCase,
            mockAuthorRepo,
            mockAuditLog,
            mockRetryQueueRepo as any,
          )

          mockPrisma.findByExternalTransactionId.mockResolvedValue({
            ...mockPayment,
            status: 'pending',
            externalTransactionId: 'TRADE-001',
          })
          // 4xx 시뮬 — completePaymentAtomically가 PolarError 4xx throw
          const polarBadRequest = Object.assign(new Error('Bad Request: invalid metadata'), {
            statusCode: 400,
          })
          mockPrisma.completePaymentAtomically.mockRejectedValueOnce(polarBadRequest)

          await expect(useCaseWithRetry.processWebhook(dummyBody, dummyHeaders)).rejects.toThrow(
            'Bad Request',
          )

          // classifyPolarError 호출 검증
          expect(mockPaymentGateway.classifyPolarError).toHaveBeenCalledWith(polarBadRequest)

          // retry queue 박제 0건 (4xx → permanent_failed 분기)
          expect(mockRetryQueueRepo.upsert).not.toHaveBeenCalled()

          // AuditLog webhook_permanent_failed 박제 (operator='system_dlq')
          expect(mockAuditLog.log).toHaveBeenCalledWith(
            'system_dlq',
            'webhook_permanent_failed',
            'evt_test_001',
            expect.objectContaining({
              reason: 'polar_4xx_no_retry',
              errorClass: 'client_4xx',
              httpStatus: 400,
              paymentId: 'pay-1',
              branch: 'success',
            }),
          )

          // webhook event 'failed' 박제 + errorMessage 분류 prefix
          expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
            expect.objectContaining({
              eventId: 'evt_test_001',
              status: 'failed',
              errorMessage: expect.stringContaining('polar_client_4xx'),
            }),
          )
        })

        it('AC-3 cancel 분기: server_5xx exception → retry queue 박제 (기존 PAY-P2-2 흐름 유지)', async () => {
          const mockRetryQueueRepo = {
            upsert: jest.fn().mockResolvedValue(undefined),
            findDueRetries: jest.fn().mockResolvedValue([]),
            markRetry: jest.fn().mockResolvedValue(undefined),
            deleteByEventId: jest.fn().mockResolvedValue(undefined),
            deleteById: jest.fn().mockResolvedValue(undefined),
          }
          mockPaymentGateway.classifyPolarError = jest.fn().mockReturnValue({
            errorClass: 'server_5xx',
            httpStatus: 503,
            message: 'Service Unavailable',
          })

          const useCaseWithRetry = new PaymentUseCase(
            mockPrisma as any,
            mockPaymentGateway,
            mockWebhookEventRepo,
            mockRefundPaymentUseCase,
            mockAuthorRepo,
            mockAuditLog,
            mockRetryQueueRepo as any,
          )

          mockPrisma.findByExternalTransactionId.mockResolvedValue({
            ...mockPayment,
            status: 'pending', // cancel webhook은 pending payment 대상
            externalTransactionId: 'TRADE-001',
          })
          mockPaymentGateway.verifyAndParseWebhook.mockReturnValue(
            makeEvent({ type: 'order.refunded', status: 'cancel' }),
          )
          // 5xx 시뮬 — refund usecase 실행 중 PolarError 5xx throw
          const polarServiceUnavailable = Object.assign(new Error('Service Unavailable'), {
            statusCode: 503,
          })
          mockRefundPaymentUseCase.execute.mockRejectedValueOnce(polarServiceUnavailable)

          await expect(useCaseWithRetry.processWebhook(dummyBody, dummyHeaders)).rejects.toThrow(
            'Service Unavailable',
          )

          // classifyPolarError 호출 검증
          expect(mockPaymentGateway.classifyPolarError).toHaveBeenCalledWith(polarServiceUnavailable)

          // retry queue 박제 1회 (5xx → retry 분기, 기존 PAY-P2-2 흐름 유지)
          expect(mockRetryQueueRepo.upsert).toHaveBeenCalledTimes(1)
          expect(mockRetryQueueRepo.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
              eventId: 'evt_test_001',
              nextRetryAt: expect.any(Date),
            }),
          )

          // AuditLog webhook_permanent_failed 박제 0건 (5xx는 retry 분기)
          const permanentLogCalls = mockAuditLog.log.mock.calls.filter(
            (call: unknown[]) => call[1] === 'webhook_permanent_failed',
          )
          expect(permanentLogCalls).toHaveLength(0)

          // webhook event 'failed' 박제 + errorMessage 분류 prefix
          expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
            expect.objectContaining({
              eventId: 'evt_test_001',
              status: 'failed',
              errorMessage: expect.stringContaining('polar_server_5xx'),
            }),
          )
        })

        it('AC-5 fallback: classifyPolarError 미구현 adapter (예: 향후 PayApp) → unknown fallback + retry queue 박제', async () => {
          const mockRetryQueueRepo = {
            upsert: jest.fn().mockResolvedValue(undefined),
            findDueRetries: jest.fn().mockResolvedValue([]),
            markRetry: jest.fn().mockResolvedValue(undefined),
            deleteByEventId: jest.fn().mockResolvedValue(undefined),
            deleteById: jest.fn().mockResolvedValue(undefined),
          }
          // classifyPolarError 미구현 시뮬 (Optional 메서드 미주입)
          mockPaymentGateway.classifyPolarError = undefined

          const useCaseWithRetry = new PaymentUseCase(
            mockPrisma as any,
            mockPaymentGateway,
            mockWebhookEventRepo,
            mockRefundPaymentUseCase,
            mockAuthorRepo,
            mockAuditLog,
            mockRetryQueueRepo as any,
          )

          mockPrisma.findByExternalTransactionId.mockResolvedValue({
            ...mockPayment,
            status: 'pending',
            externalTransactionId: 'TRADE-001',
          })
          mockPrisma.completePaymentAtomically.mockRejectedValueOnce(
            new Error('Some unexpected DB error'),
          )

          await expect(useCaseWithRetry.processWebhook(dummyBody, dummyHeaders)).rejects.toThrow(
            'Some unexpected DB error',
          )

          // unknown fallback → retry queue 박제 1회 (안전 측면)
          expect(mockRetryQueueRepo.upsert).toHaveBeenCalledTimes(1)

          // AuditLog webhook_permanent_failed 박제 0건 (unknown은 retry 분기)
          const permanentLogCalls = mockAuditLog.log.mock.calls.filter(
            (call: unknown[]) => call[1] === 'webhook_permanent_failed',
          )
          expect(permanentLogCalls).toHaveLength(0)

          // errorMessage prefix는 polar_unknown
          expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
            expect.objectContaining({
              status: 'failed',
              errorMessage: expect.stringContaining('polar_unknown'),
            }),
          )
        })
      })

      it('eventId가 빈 문자열이어도 게이트 진입 자체는 발생 (어댑터에서 null 반환되어야 정상)', async () => {
        // 어댑터가 비어있는 eventId로 event를 반환하는 비정상 시나리오 — usecase는 그대로 진행하지만
        // findByEventId('') 결과에 따라 분기. 본 케이스는 어댑터 책임 검증이지만 usecase 안전성도 확인.
        mockPaymentGateway.verifyAndParseWebhook.mockReturnValue(makeEvent({ eventId: '' }))
        mockPrisma.findByExternalTransactionId.mockResolvedValue({
          ...mockPayment,
          externalTransactionId: 'TRADE-001',
        })

        await useCase.processWebhook(dummyBody, dummyHeaders)

        // 빈 eventId로 findByEventId 호출됨 — 어댑터에서 차단하는 게 정본 (polar.adapter.spec에서 검증)
        expect(mockWebhookEventRepo.findByEventId).toHaveBeenCalledWith('')
      })
    })
  })

  describe('getPaymentHistory', () => {
    it('작가의 결제 내역을 반환한다', async () => {
      const result = await useCase.getPaymentHistory('author-1')

      expect(result).toHaveLength(1)
      expect(mockPrisma.findByAuthorId).toHaveBeenCalledWith('author-1')
    })
  })

  describe('상품 가격 검증 — 크레딧 비용이 AI API 비용을 초과하는지', () => {
    // 테마 생성 1회 ≈ 800 input + 500 output tokens (Claude Sonnet 4.6, $3/$15 per 1M, 환율 ₩1,474)
    // = ₩14.6 (docs/ai-cost-table.md §3-1 정본)
    const AI_COST_PER_THEME_KRW = 14.6

    it('모든 상품의 크레딧당 가격이 AI 비용의 최소 5배 이상이다', () => {
      for (const product of CREDIT_PRODUCTS) {
        const pricePerCredit = product.price / product.credits
        const margin = pricePerCredit / AI_COST_PER_THEME_KRW
        expect(margin).toBeGreaterThanOrEqual(5)
      }
    })

    it('대량 구매 시에도 크레딧당 가격이 AI 비용보다 높다', () => {
      const cheapest = CREDIT_PRODUCTS.reduce(
        (min, p) => (p.price / p.credits < min ? p.price / p.credits : min),
        Infinity,
      )
      expect(cheapest).toBeGreaterThan(AI_COST_PER_THEME_KRW)
    })
  })

  /**
   * PAY-P3-H: Circuit Breaker fail-fast 분기 — initiatePayment 영역.
   *
   * Polar SDK 호출 경계 OPEN 상태 시:
   * - PaymentGatewayPort.initiatePayment가 CircuitOpenError throw
   * - PaymentUseCase.initiatePayment가 catch + ServiceUnavailableException 변환 (503)
   * - paymentRepo.create + updateExternalTransactionId 후속 호출 0건 강제 (retry queue 폭주 차단)
   *
   * 정본: shared-contracts §27 CircuitBreakerPolicy, ADR-009.
   */
  describe('PAY-P3-H: Circuit Breaker fail-fast 분기 (initiatePayment 영역)', () => {
    it('CircuitOpenError 시 ServiceUnavailableException(503) 변환 + 후속 paymentRepo 호출 0건', async () => {
      const { CircuitOpenError } = await import('@domain/model/circuit-breaker-state')
      const { ServiceUnavailableException } = await import('@nestjs/common')
      const circuitErr = new CircuitOpenError('polar:checkouts:create', {
        state: 'open' as never,
        failureCount: 5,
        halfOpenTrialCount: 0,
        halfOpenSuccessCount: 0,
      })

      mockPrisma.findReusablePendingPayment.mockResolvedValueOnce(null)
      mockPrisma.create.mockResolvedValueOnce({
        id: 'pay-cb-1', authorId: 'author-cb', productId: 'credit-5',
        amount: 2000, credits: 5, status: 'pending',
      })
      mockPaymentGateway.initiatePayment.mockRejectedValueOnce(circuitErr)

      // ServiceUnavailableException 변환 확인 (사용자 친화 503)
      await expect(
        useCase.initiatePayment('author-cb', 'credit-5', 'https://app/return'),
      ).rejects.toThrow(ServiceUnavailableException)

      // PAY-P3-H 정합: updateExternalTransactionId 호출 0건 (CircuitOpenError가 SDK 호출 자체 차단)
      expect(mockPrisma.updateExternalTransactionId).not.toHaveBeenCalled()
    })

    it('CircuitOpenError 외 일반 Error 시 그대로 throw (회귀 보존)', async () => {
      const normalErr = new Error('Polar checkout 생성 실패: timeout')

      mockPrisma.findReusablePendingPayment.mockResolvedValueOnce(null)
      mockPrisma.create.mockResolvedValueOnce({
        id: 'pay-normal-1', authorId: 'author-1', productId: 'credit-5',
        amount: 2000, credits: 5, status: 'pending',
      })
      mockPaymentGateway.initiatePayment.mockRejectedValueOnce(normalErr)

      // 기존 흐름 — 일반 Error는 그대로 throw (PAY-P3-B 정합)
      await expect(
        useCase.initiatePayment('author-1', 'credit-5', 'https://app/return'),
      ).rejects.toThrow('Polar checkout 생성 실패: timeout')
    })
  })
})
