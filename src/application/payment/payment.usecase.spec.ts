import { PaymentUseCase, CREDIT_PRODUCTS } from './payment.usecase'
import { BadRequestException } from '@nestjs/common'

describe('PaymentUseCase', () => {
  let useCase: PaymentUseCase
  let mockPrisma: any
  let mockCreditUseCase: any
  let mockPaymentGateway: any

  const mockPayment = {
    id: 'pay-1',
    authorId: 'author-1',
    productId: 'credit-10',
    amount: 1000,
    credits: 10,
    payappTradeNo: null,
    status: 'pending',
    createdAt: new Date(),
    completedAt: null,
  }

  beforeEach(() => {
    // $transaction mock: 콜백을 받아서 동일한 mock prisma를 tx로 넘긴다
    const paymentMock = {
      create: jest.fn().mockResolvedValue(mockPayment),
      update: jest.fn().mockResolvedValue({ ...mockPayment, payappTradeNo: 'TRADE-001' }),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([mockPayment]),
    }
    const authorMock = {
      update: jest.fn().mockResolvedValue({ id: 'author-1', credits: 13 }),
    }
    const creditLogMock = {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    }

    mockPrisma = {
      payment: paymentMock,
      author: authorMock,
      creditLog: creditLogMock,
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
        // 트랜잭션 콜백에 동일한 mock을 tx로 전달
        return cb({ payment: paymentMock, author: authorMock, creditLog: creditLogMock })
      }),
    }

    mockCreditUseCase = {
      grant: jest.fn().mockResolvedValue({ credits: 13, log: {} }),
      getBalance: jest.fn().mockResolvedValue(10),
    }

    mockPaymentGateway = {
      initiatePayment: jest.fn().mockResolvedValue({
        paymentUrl: 'https://payapp.kr/pay/test',
        tradeNo: 'TRADE-001',
      }),
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
    }

    useCase = new PaymentUseCase(mockPrisma, mockCreditUseCase, mockPaymentGateway)
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

    it('상품 가격이 올바르다', () => {
      const products = useCase.getProducts()
      const p10 = products.find((p) => p.id === 'credit-10')!
      const p30 = products.find((p) => p.id === 'credit-30')!
      const p100 = products.find((p) => p.id === 'credit-100')!

      expect(p10.price).toBe(1000)
      expect(p30.price).toBe(2500)
      expect(p100.price).toBe(7000)
    })
  })

  describe('initiatePayment', () => {
    it('pending 상태 Payment를 생성하고 게이트웨이를 호출한다', async () => {
      const result = await useCase.initiatePayment('author-1', 'credit-10', 'https://example.com/return')

      expect(mockPrisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          authorId: 'author-1',
          productId: 'credit-10',
          amount: 1000,
          credits: 10,
          status: 'pending',
        }),
      })
      expect(mockPaymentGateway.initiatePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'credit-10',
          productName: '10 크레딧',
          amount: 1000,
        }),
      )
      expect(result.paymentUrl).toBe('https://payapp.kr/pay/test')
      expect(result.tradeNo).toBe('TRADE-001')
    })

    it('tradeNo를 Payment 레코드에 업데이트한다', async () => {
      await useCase.initiatePayment('author-1', 'credit-10', 'https://example.com/return')

      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { payappTradeNo: 'TRADE-001' },
      })
    })

    it('존재하지 않는 productId면 예외를 던진다', async () => {
      await expect(
        useCase.initiatePayment('author-1', 'credit-999', 'https://example.com/return'),
      ).rejects.toThrow(BadRequestException)

      expect(mockPrisma.payment.create).not.toHaveBeenCalled()
      expect(mockPaymentGateway.initiatePayment).not.toHaveBeenCalled()
    })
  })

  describe('processWebhook', () => {
    const successPayload = {
      tradeNo: 'TRADE-001',
      amount: 1000,
      status: 'success',
      signature: 'valid-sig',
    }

    it('서명 검증에 실패하면 예외를 던진다', async () => {
      mockPaymentGateway.verifyWebhookSignature.mockReturnValue(false)

      await expect(useCase.processWebhook(successPayload)).rejects.toThrow('웹훅 서명 검증 실패')
    })

    it('tradeNo에 해당하는 결제가 없으면 무시한다 (멱등성)', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(null)

      const result = await useCase.processWebhook(successPayload)

      expect(result.processed).toBe(false)
      expect(result.reason).toBe('unknown_trade')
    })

    it('이미 completed인 결제는 무시한다 (중복 웹훅 방지)', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: 'completed',
        payappTradeNo: 'TRADE-001',
      })

      const result = await useCase.processWebhook(successPayload)

      expect(result.processed).toBe(false)
      expect(result.reason).toBe('already_completed')
      expect(mockCreditUseCase.grant).not.toHaveBeenCalled()
    })

    it('성공 웹훅 시 원자적 트랜잭션으로 크레딧 부여 + 상태 변경한다', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        payappTradeNo: 'TRADE-001',
      })

      const result = await useCase.processWebhook(successPayload)

      expect(result.processed).toBe(true)
      expect(result.credits).toBe(10)
      // $transaction이 호출되었는지 (원자성 보장)
      expect(mockPrisma.$transaction).toHaveBeenCalled()
      // 트랜잭션 내에서 payment 상태 변경
      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: 'completed', completedAt: expect.any(Date) },
      })
      // 트랜잭션 내에서 크레딧 증가
      expect(mockPrisma.author.update).toHaveBeenCalledWith({
        where: { id: 'author-1' },
        data: { credits: { increment: 10 } },
      })
      // 트랜잭션 내에서 크레딧 로그 생성
      expect(mockPrisma.creditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          authorId: 'author-1',
          amount: 10,
        }),
      })
    })

    it('실패 웹훅 시 상태를 failed로 변경하고 크레딧을 부여하지 않는다', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        payappTradeNo: 'TRADE-001',
      })

      const result = await useCase.processWebhook({
        ...successPayload,
        status: 'fail',
      })

      expect(result.processed).toBe(true)
      expect(result.credits).toBe(0)
      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: 'failed' },
      })
      expect(mockCreditUseCase.grant).not.toHaveBeenCalled()
    })

    it('취소 웹훅 시 상태를 failed로 변경한다', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        payappTradeNo: 'TRADE-001',
      })

      const result = await useCase.processWebhook({
        ...successPayload,
        status: 'cancel',
      })

      expect(result.processed).toBe(true)
      expect(result.credits).toBe(0)
      expect(mockCreditUseCase.grant).not.toHaveBeenCalled()
    })
  })

  describe('getPaymentHistory', () => {
    it('작가의 결제 내역을 반환한다', async () => {
      const result = await useCase.getPaymentHistory('author-1')

      expect(result).toHaveLength(1)
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith({
        where: { authorId: 'author-1' },
        orderBy: { createdAt: 'desc' },
      })
    })
  })

  describe('상품 가격 검증 — 크레딧 비용이 AI API 비용을 초과하는지', () => {
    // 테마 생성 1회 ≈ 2000 tokens ≈ 약 12원 (Claude Sonnet 기준)
    const AI_COST_PER_THEME_KRW = 12

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
