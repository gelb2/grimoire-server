import { PaymentUseCase } from './payment.usecase'
import { BadRequestException } from '@nestjs/common'

describe('PaymentUseCase', () => {
  let useCase: PaymentUseCase
  let mockCreditUseCase: any

  beforeEach(() => {
    mockCreditUseCase = {
      grant: jest.fn().mockResolvedValue({ credits: 25, log: {} }),
      getBalance: jest.fn().mockResolvedValue(10),
    }
    useCase = new PaymentUseCase(mockCreditUseCase)
  })

  describe('getProducts', () => {
    it('3개의 상품을 반환한다', () => {
      const products = useCase.getProducts()

      expect(products).toHaveLength(3)
      expect(products[0]).toHaveProperty('id')
      expect(products[0]).toHaveProperty('credits')
      expect(products[0]).toHaveProperty('priceKrw')
      expect(products[0]).toHaveProperty('pricePerCredit')
    })
  })

  describe('processWebhook', () => {
    it('유효한 결제에 대해 크레딧을 부여한다', async () => {
      const result = await useCase.processWebhook({
        paymentId: 'pay-123',
        productId: 'credit_20',
        authorId: 'author-1',
        status: 'completed',
      })

      expect(result.processed).toBe(true)
      expect(result.credits).toBe(25)
      expect(mockCreditUseCase.grant).toHaveBeenCalledWith(
        'author-1',
        20,
        'purchase_credit_20_pay-123',
      )
    })

    it('completed가 아닌 상태는 무시한다', async () => {
      const result = await useCase.processWebhook({
        paymentId: 'pay-123',
        productId: 'credit_20',
        authorId: 'author-1',
        status: 'pending',
      })

      expect(result.processed).toBe(false)
      expect(mockCreditUseCase.grant).not.toHaveBeenCalled()
    })

    it('알 수 없는 상품이면 예외를 던진다', async () => {
      await expect(
        useCase.processWebhook({
          paymentId: 'pay-123',
          productId: 'credit_999',
          authorId: 'author-1',
          status: 'completed',
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
