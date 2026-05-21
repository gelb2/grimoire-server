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

  // CC-2a 디노미 — credits 는 충전 총 pt (입문 패키지 25,000pt), productId 는 신 4종 id.
  const mockPayment = {
    id: 'pay-1',
    authorId: 'author-1',
    productId: 'credit-starter',
    amount: 3000,
    credits: 25000,
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
    amount: 3000,
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
      // CC-2a — 신 충전 적립 트랜잭션 메서드. 기본: 외상 0 → 전액 충전 적립 (입문 25,000pt)
      // (CC-4 P1 — 구 completePaymentAtomically port 시그니처 자체 제거)
      completePaymentWithPoints: jest
        .fn()
        .mockResolvedValue({ settledDeficit: 0, chargedPoints: 25000 }),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      // CC-2b — 신 환불 신 경로 (4 출처 환수 + 이중 외상 통합)
      // (CC-4 P1 — 구 refundPaymentAtomically port 시그니처 자체 제거)
      refundPaymentWithPoints: jest.fn().mockResolvedValue({
        actualRefunded: 0, deficitIncurred: 0, proportionalPt: 0, isPartial: false,
      }),
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

    // CC-2b — refund usecase mock (신 시그니처 actualRefunded/deficitIncurred/proportionalPt/isPartial)
    mockRefundPaymentUseCase = {
      execute: jest.fn().mockResolvedValue({
        actualRefunded: 0, deficitIncurred: 0, proportionalPt: 0, isPartial: false,
      }),
    }

    // Sprint PAY-P2-4 — authorRepo + auditLog mock (success 분기 잔액 조회 + audit 박제)
    // CC-2a — 충전 success 분기는 author.pointsCharged(충전 출처 캐시) 를 beforeState 로 읽음.
    mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'author-1', slug: 'a', name: 'A', email: 'a@a.com',
        role: 'user', credits: 50, plan: 'free', planExpireAt: null, createdAt: new Date(),
        pointsFree: 0, pointsSubscription: 0, pointsGift: 0, pointsCharged: 10000,
        deficitPoints: 0,
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
    // CC-2a 디노미 4종 — ai-cost-table §2 정본
    it('4개의 충전 패키지를 반환한다 (CC-2a 디노미 개편)', () => {
      const products = useCase.getProducts()

      expect(products).toHaveLength(4)
      expect(products[0]).toHaveProperty('id')
      expect(products[0]).toHaveProperty('name')
      expect(products[0]).toHaveProperty('points')
      expect(products[0]).toHaveProperty('bonusRate')
      expect(products[0]).toHaveProperty('price')
      expect(products[0]).toHaveProperty('pricePerPoint')
    })

    it('상품 가격·포인트가 ai-cost-table §2 정본과 1:1 정합한다', () => {
      const products = useCase.getProducts()
      const starter = products.find((p) => p.id === 'credit-starter')!
      const basic = products.find((p) => p.id === 'credit-basic')!
      const popular = products.find((p) => p.id === 'credit-popular')!
      const best = products.find((p) => p.id === 'credit-best')!

      // 충전액 (KRW)
      expect(starter.price).toBe(3000)
      expect(basic.price).toBe(5000)
      expect(popular.price).toBe(10000)
      expect(best.price).toBe(30000)

      // 총 충전 포인트 (기본 + 보너스)
      expect(starter.points).toBe(25000)
      expect(basic.points).toBe(41667)
      expect(popular.points).toBe(91667)
      expect(best.points).toBe(287500)

      // 보너스율 (§8-5 안전 권고 상한)
      expect(starter.bonusRate).toBe(0)
      expect(basic.bonusRate).toBe(0)
      expect(popular.bonusRate).toBe(0.1)
      expect(best.bonusRate).toBe(0.15)
    })
  })

  describe('initiatePayment', () => {
    it('pending 상태 Payment를 생성하고 게이트웨이를 호출한다', async () => {
      const result = await useCase.initiatePayment('author-1', 'credit-starter', 'https://example.com/return')

      // CC-2a 디노미 — 입문 패키지: 충전액 ₩3,000, credits 컬럼에 충전 총 pt 25,000 저장
      expect(mockPrisma.create).toHaveBeenCalledWith(
        expect.objectContaining({
          authorId: 'author-1',
          productId: 'credit-starter',
          amount: 3000,
          credits: 25000,
        }),
      )
      expect(mockPaymentGateway.initiatePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'credit-starter',
          productName: '입문 패키지',
          amount: 3000,
        }),
      )
      expect(result.paymentUrl).toBe('https://example.com/pay/test')
      expect(result.tradeNo).toBe('TRADE-001')
    })

    it('externalTransactionId를 Payment 레코드에 업데이트한다', async () => {
      await useCase.initiatePayment('author-1', 'credit-starter', 'https://example.com/return')

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
        productId: 'credit-starter',
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
          'credit-starter',
          'https://example.com/return',
        )

        // 진입 게이트 호출 정합 — (authorId, productId, expireSince=Date 객체)
        expect(mockPrisma.findReusablePendingPayment).toHaveBeenCalledTimes(1)
        expect(mockPrisma.findReusablePendingPayment).toHaveBeenCalledWith(
          'author-1',
          'credit-starter',
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
          'credit-starter',
          'https://example.com/return',
        )

        // 진입 게이트 호출 1회
        expect(mockPrisma.findReusablePendingPayment).toHaveBeenCalledTimes(1)

        // 신규 create 1회 (재사용 후보 없음) — CC-2a 디노미: 입문 패키지 ₩3,000 / 25,000pt
        expect(mockPrisma.create).toHaveBeenCalledTimes(1)
        expect(mockPrisma.create).toHaveBeenCalledWith(
          expect.objectContaining({
            authorId: 'author-1',
            productId: 'credit-starter',
            amount: 3000,
            credits: 25000,
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
        await useCase.initiatePayment('author-1', 'credit-starter', 'https://example.com/return')
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

        const r1 = await useCase.initiatePayment('author-1', 'credit-starter', 'https://r')
        const r2 = await useCase.initiatePayment('author-1', 'credit-starter', 'https://r')

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
      // CC-4 P1: 구 CreditUseCase.grant port 자체 제거됨 → mockCreditUseCase.grant 검증 불요
      expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt_test_001',
          status: 'skipped',
          errorMessage: 'already_completed',
        }),
      )
    })

    it('성공 웹훅 시 completePaymentWithPoints 단일 트랜잭션으로 충전 적립 + 상태 변경 + webhook event를 processed로 박제한다 (CC-2a)', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      expect(result.processed).toBe(true)
      // credits 필드 = 충전 총 pt (입문 25,000pt)
      expect(result.credits).toBe(25000)
      // CC-2a — 충전 success 는 신 completePaymentWithPoints 사용
      // (CC-4 P1: 구 completePaymentAtomically port 자체 제거됨 → 호출 검증 불요)
      expect(mockPrisma.completePaymentWithPoints).toHaveBeenCalledWith(
        'pay-1', 'author-1', 25000, 'credit-starter', 'pay-1',
      )
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

    // PAY-P2-4 + CC-2a: 성공 분기에서 잔액 사전 조회 + auditLog beforeState/afterState 박제
    it('PAY-P2-4+CC-2a: 성공 웹훅 시 authorRepo.findById 1회 + auditLog.log pt 기준(payment_completed) 박제', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })

      await useCase.processWebhook(dummyBody, dummyHeaders)

      // 잔액 사전 조회 호출 확인
      expect(mockAuthorRepo.findById).toHaveBeenCalledTimes(1)
      expect(mockAuthorRepo.findById).toHaveBeenCalledWith('author-1')

      // CC-2a 디노미 — beforeState/afterState 는 충전 출처 캐시(pointsCharged) pt 기준.
      // before pointsCharged=10,000 → after = 10,000 + chargedPoints(25,000) = 35,000
      expect(mockAuditLog.log).toHaveBeenCalledTimes(1)
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'system_payment',
        'payment_completed',
        'pay-1',
        expect.objectContaining({
          reason: 'polar_webhook_order.paid',
          externalTransactionId: 'TRADE-001',
        }),
        { pointsCharged: 10000 }, // mockAuthorRepo pointsCharged 베이스
        expect.objectContaining({
          pointsCharged: 35000, // 10,000 + chargedPoints 25,000
          paymentId: 'pay-1',
          totalPoints: 25000,
          chargedPoints: 25000,
          settledDeficit: 0,
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
      expect(result.credits).toBe(25000)
      expect(mockPrisma.completePaymentWithPoints).toHaveBeenCalledTimes(1)

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
      expect(result.credits).toBe(25000)
      expect(mockPrisma.completePaymentWithPoints).toHaveBeenCalledTimes(1)
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

    it('취소(cancel) 웹훅 시 refund usecase 1회 호출 + status="refunded" + deficitCredits 응답 포함 (CC-2b 신 경로)', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })
      // CC-2b 디노미 — payment.credits 는 충전 총 pt 25,000 → refundPt 로 그대로 전달.
      mockPaymentGateway.verifyAndParseWebhook.mockReturnValue(
        makeEvent({ type: 'order.refunded', status: 'cancel', amount: 3000 }),
      )
      mockRefundPaymentUseCase.execute.mockResolvedValueOnce({
        actualRefunded: 25000,
        deficitIncurred: 0,
        proportionalPt: 25000,
        isPartial: false,
      })

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      // CC-2b: refund usecase 정확히 1회 호출 + 신 시그니처(refundPt) 정합
      expect(mockRefundPaymentUseCase.execute).toHaveBeenCalledTimes(1)
      expect(mockRefundPaymentUseCase.execute).toHaveBeenCalledWith({
        paymentId: 'pay-1',
        authorId: 'author-1',
        refundPt: 25000,
        refundedAmount: 3000,
        reason: 'polar_webhook_order.refunded',
        source: 'webhook',
      })

      // updateStatus는 호출 0회 — refund usecase 내부의 $transaction이 status를 처리
      expect(mockPrisma.updateStatus).not.toHaveBeenCalled()

      // 응답에 deficitCredits 포함 (정상 환수 시 0) — payment.usecase 가 deficitIncurred 를 매핑
      expect(result.processed).toBe(true)
      expect(result.credits).toBe(0)
      expect(result).toHaveProperty('deficitCredits', 0)

      // webhook event 박제
      expect(mockWebhookEventRepo.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt_test_001', status: 'processed' }),
      )
    })

    it('취소(cancel) 웹훅 + 잔액 부족 시 deficitIncurred 양수로 응답에 박제 (CC-2b 이중 외상 통합)', async () => {
      mockPrisma.findByExternalTransactionId.mockResolvedValue({
        ...mockPayment,
        externalTransactionId: 'TRADE-001',
      })
      mockPaymentGateway.verifyAndParseWebhook.mockReturnValue(
        makeEvent({ type: 'order.refunded', status: 'cancel' }),
      )
      mockRefundPaymentUseCase.execute.mockResolvedValueOnce({
        actualRefunded: 3000,
        deficitIncurred: 2000,
        proportionalPt: 5000,
        isPartial: false,
      })

      const result = await useCase.processWebhook(dummyBody, dummyHeaders)

      expect(result).toEqual(expect.objectContaining({
        processed: true,
        credits: 0,
        deficitCredits: 2000,
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
      it('동일 eventId로 webhook 두 번 호출 시 첫 호출만 completePaymentWithPoints 실행한다 (CC-2a)', async () => {
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
        expect(first.credits).toBe(25000)
        expect(second.processed).toBe(false)
        expect(second.reason).toBe('duplicate_event')

        // 핵심: completePaymentWithPoints는 단 1회만 호출되어야 한다 (멱등성 회귀 보존)
        expect(mockPrisma.completePaymentWithPoints).toHaveBeenCalledTimes(1)
        expect(mockPrisma.completePaymentWithPoints).toHaveBeenCalledWith(
          'pay-1', 'author-1', 25000, 'credit-starter', 'pay-1',
        )

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
        expect(result.credits).toBe(25000)
        expect(mockPrisma.completePaymentWithPoints).toHaveBeenCalledTimes(1)
      })

      it('completePaymentWithPoints 실패 시 webhook event를 failed로 박제하고 throw한다 (CC-2a)', async () => {
        mockPrisma.findByExternalTransactionId.mockResolvedValue({
          ...mockPayment,
          externalTransactionId: 'TRADE-001',
        })
        mockPrisma.completePaymentWithPoints.mockRejectedValueOnce(new Error('DB connection lost'))

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
        it('AC-1: payment.status=refunded 시 succeeded webhook 재진입은 skip + completePaymentWithPoints 호출 0건', async () => {
          mockPrisma.findByExternalTransactionId.mockResolvedValue({
            ...mockPayment,
            status: 'refunded',
            externalTransactionId: 'TRADE-001',
          })

          const result = await useCase.processWebhook(dummyBody, dummyHeaders)

          // 사전 게이트 차단 — 충전 트랜잭션(completePaymentWithPoints) 호출 0건 (재적립 0건 보장)
          expect(mockPrisma.completePaymentWithPoints).not.toHaveBeenCalled()
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

        it('AC-2: payment.status=partial_refunded 시 추가 환불 webhook 진입은 skip + refund usecase 호출 0건 (CC-4 P1 정합)', async () => {
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
          // completePaymentWithPoints도 0건 (cancel 분기이지만 게이트가 우선 차단)
          expect(mockPrisma.completePaymentWithPoints).not.toHaveBeenCalled()

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
            actualRefunded: 5,
            deficitIncurred: 0,
            proportionalPt: 5,
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

        it('AC-6: completePaymentWithPoints 트랜잭션 실패 (CAS_MISMATCH 시뮬) 시 webhook event failed 박제 + DLQ enqueue + throw', async () => {
          // PAY-P3-A: 트랜잭션 CAS_MISMATCH throw → 호출자 catch → webhookEvent failed
          // 본 spec은 success 분기로 시뮬 (cancel 분기는 refund usecase 내부 catch로 동일 패턴)
          mockPrisma.findByExternalTransactionId.mockResolvedValue({
            ...mockPayment,
            status: 'pending', // 사전 게이트 통과 (success 분기 정상 진입)
            externalTransactionId: 'TRADE-001',
          })
          // CAS_MISMATCH 시뮬 — completePaymentWithPoints가 race window throw (CC-2a)
          mockPrisma.completePaymentWithPoints.mockRejectedValueOnce(
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
          // 4xx 시뮬 — completePaymentWithPoints가 PolarError 4xx throw (CC-2a)
          const polarBadRequest = Object.assign(new Error('Bad Request: invalid metadata'), {
            statusCode: 400,
          })
          mockPrisma.completePaymentWithPoints.mockRejectedValueOnce(polarBadRequest)

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
          mockPrisma.completePaymentWithPoints.mockRejectedValueOnce(
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

  describe('충전 패키지 §0 원가 검증 (CC-2a 디노미 — ai-cost-table §2/§7-4 정본)', () => {
    // §0 원가 철칙: 충전 pt 가 AI 원가의 3배 이상. 모든 차감 N 은
    // ceil(스트레스 AI원가 × 3 ÷ §0최악단가)로 산출 (ai-cost-table §3 헤더).
    // §0 최악 기준 = 입문 패키지 실효 순단가 ≈ ₩0.09856 (순수령액 ÷ 총 pt, 5자리 반올림 표기).
    // → 차감 N 산출에 쓰이는 §0 기준이 "최저 실효 순단가" 이므로, 입문이 4종 중 최저이고
    //   보너스(인기 +10% / 베스트 +15%)가 입문보다 단가를 낮추지 않으면 §0 PASS
    //   (cost-accountant 승인 786b0f3).
    const POLAR_PERCENT = 0.029
    const POLAR_FIXED_KRW = 449.12
    // ai-cost-table §2 표기 기준값 (5자리 반올림) — 정밀 계산값은 0.0985552
    const FLOOR_NET_UNIT_KRW = 0.09856

    /** Polar 수수료 차감 후 실효 순단가 = (충전액 − 수수료) ÷ 총 pt */
    const effectiveNetUnit = (price: number, points: number): number => {
      const polarFee = price * POLAR_PERCENT + POLAR_FIXED_KRW
      return (price - polarFee) / points
    }

    it('입문 패키지가 §0 최악 기준이다 (4종 중 최저 실효 순단가 ≈ ₩0.09856)', () => {
      const starter = CREDIT_PRODUCTS.find((p) => p.id === 'credit-starter')!
      const cheapestNetUnit = CREDIT_PRODUCTS.reduce(
        (min, p) => Math.min(min, effectiveNetUnit(p.price, p.points)),
        Infinity,
      )
      // 입문이 4종 중 최저 실효 순단가 = §0 최악 기준 (ai-cost-table §2)
      expect(effectiveNetUnit(starter.price, starter.points)).toBeCloseTo(cheapestNetUnit, 6)
      // ai-cost-table §2 표기값 ₩0.09856 과 4자리까지 일치 (정밀값 0.0985552)
      expect(cheapestNetUnit).toBeCloseTo(FLOOR_NET_UNIT_KRW, 4)
    })

    it('보너스 패키지(인기·베스트)가 §0 최악 기준(입문)보다 단가를 낮추지 않는다', () => {
      const starterNetUnit = effectiveNetUnit(3000, 25000)
      // 보너스가 §0 를 깨면 보너스 패키지 실효 순단가가 입문보다 낮아짐 — 그렇지 않음을 검증.
      // 부동소수점 안전 — 1e-9 허용 오차로 "이상" 판정 (ai-cost-table §2 검증표 정합).
      for (const product of CREDIT_PRODUCTS) {
        const netUnit = effectiveNetUnit(product.price, product.points)
        expect(netUnit).toBeGreaterThanOrEqual(starterNetUnit - 1e-9)
      }
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
        id: 'pay-cb-1', authorId: 'author-cb', productId: 'credit-starter',
        amount: 2000, credits: 5, status: 'pending',
      })
      mockPaymentGateway.initiatePayment.mockRejectedValueOnce(circuitErr)

      // ServiceUnavailableException 변환 확인 (사용자 친화 503)
      await expect(
        useCase.initiatePayment('author-cb', 'credit-starter', 'https://app/return'),
      ).rejects.toThrow(ServiceUnavailableException)

      // PAY-P3-H 정합: updateExternalTransactionId 호출 0건 (CircuitOpenError가 SDK 호출 자체 차단)
      expect(mockPrisma.updateExternalTransactionId).not.toHaveBeenCalled()
    })

    it('CircuitOpenError 외 일반 Error 시 그대로 throw (회귀 보존)', async () => {
      const normalErr = new Error('Polar checkout 생성 실패: timeout')

      mockPrisma.findReusablePendingPayment.mockResolvedValueOnce(null)
      mockPrisma.create.mockResolvedValueOnce({
        id: 'pay-normal-1', authorId: 'author-1', productId: 'credit-starter',
        amount: 2000, credits: 5, status: 'pending',
      })
      mockPaymentGateway.initiatePayment.mockRejectedValueOnce(normalErr)

      // 기존 흐름 — 일반 Error는 그대로 throw (PAY-P3-B 정합)
      await expect(
        useCase.initiatePayment('author-1', 'credit-starter', 'https://app/return'),
      ).rejects.toThrow('Polar checkout 생성 실패: timeout')
    })
  })
})
