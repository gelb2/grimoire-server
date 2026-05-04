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

    useCase = new PaymentUseCase(
      mockPaymentRepo as any,
      mockPaymentGateway,
      mockWebhookEventRepo,
      mockRefundPaymentUseCase,
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
})
