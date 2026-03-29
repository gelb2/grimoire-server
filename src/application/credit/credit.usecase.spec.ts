import { CreditUseCase } from './credit.usecase'
import { BadRequestException } from '@nestjs/common'

describe('CreditUseCase', () => {
  let useCase: CreditUseCase
  let mockCreditRepo: { adjustCredits: jest.Mock; findLogsByAuthorId: jest.Mock; giftTransfer: jest.Mock; getGiftRanking: jest.Mock }
  let mockAuthorRepo: { findById: jest.Mock; findBySlug: jest.Mock; findByEmail: jest.Mock; create: jest.Mock; updateCredits: jest.Mock }

  const mockAuthor = { id: 'author-1', slug: 'test', name: '테스트', email: 'test@test.com', credits: 3, createdAt: new Date() }
  const mockLog = { id: 'log-1', authorId: 'author-1', amount: -1, reason: 'theme_generate', createdAt: new Date() }

  beforeEach(() => {
    mockCreditRepo = {
      adjustCredits: jest.fn().mockResolvedValue({ credits: 2, log: mockLog }),
      findLogsByAuthorId: jest.fn().mockResolvedValue([mockLog]),
      giftTransfer: jest.fn().mockResolvedValue({ senderCredits: 2, receiverCredits: 4 }),
      getGiftRanking: jest.fn().mockResolvedValue([{ authorId: 'author-2', totalGifted: 10 }]),
    }
    mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue(mockAuthor),
      findBySlug: jest.fn(), findByEmail: jest.fn(), create: jest.fn(), updateCredits: jest.fn(),
    }

    useCase = new CreditUseCase(mockCreditRepo as any, mockAuthorRepo as any)
  })

  describe('deduct', () => {
    it('크레딧을 차감하고 로그를 반환한다', async () => {
      const result = await useCase.deduct('author-1', 1, 'theme_generate')

      expect(mockCreditRepo.adjustCredits).toHaveBeenCalledWith('author-1', -1, 'theme_generate')
      expect(result.credits).toBe(2)
    })

    it('차감 금액이 0 이하이면 에러를 던진다', async () => {
      await expect(useCase.deduct('author-1', 0, 'test')).rejects.toThrow(BadRequestException)
      await expect(useCase.deduct('author-1', -1, 'test')).rejects.toThrow(BadRequestException)
    })

    it('크레딧이 부족하면 에러를 던진다', async () => {
      mockAuthorRepo.findById.mockResolvedValue({ ...mockAuthor, credits: 0 })

      await expect(useCase.deduct('author-1', 1, 'test')).rejects.toThrow('크레딧이 부족합니다')
    })

    it('작가가 없으면 에러를 던진다', async () => {
      mockAuthorRepo.findById.mockResolvedValue(null)

      await expect(useCase.deduct('no-author', 1, 'test')).rejects.toThrow('작가를 찾을 수 없습니다')
    })
  })

  describe('grant', () => {
    it('크레딧을 적립하고 로그를 반환한다', async () => {
      mockCreditRepo.adjustCredits.mockResolvedValue({ credits: 4, log: { ...mockLog, amount: 1 } })

      const result = await useCase.grant('author-1', 1, 'signup_bonus')

      expect(mockCreditRepo.adjustCredits).toHaveBeenCalledWith('author-1', 1, 'signup_bonus')
      expect(result.credits).toBe(4)
    })

    it('적립 금액이 0 이하이면 에러를 던진다', async () => {
      await expect(useCase.grant('author-1', 0, 'test')).rejects.toThrow(BadRequestException)
    })
  })

  describe('getBalance', () => {
    it('작가의 크레딧 잔액을 반환한다', async () => {
      const balance = await useCase.getBalance('author-1')
      expect(balance).toBe(3)
    })
  })

  describe('getLogs', () => {
    it('작가의 크레딧 로그를 반환한다', async () => {
      const logs = await useCase.getLogs('author-1')
      expect(logs).toHaveLength(1)
      expect(logs[0].reason).toBe('theme_generate')
    })
  })

  describe('gift', () => {
    const mockReceiver = { id: 'author-2', slug: 'recv', name: '수신자', email: 'recv@test.com', credits: 3, createdAt: new Date() }

    it('크레딧을 선물하고 양쪽 잔액을 반환한다', async () => {
      mockAuthorRepo.findById
        .mockResolvedValueOnce(mockAuthor)   // sender
        .mockResolvedValueOnce(mockReceiver)  // receiver

      const result = await useCase.gift('author-1', 'author-2', 1)

      expect(mockCreditRepo.giftTransfer).toHaveBeenCalledWith(
        'author-1', 'author-2', 1, 'gift_sent:author-2', 'gift_received:author-1',
      )
      expect(result.senderCredits).toBe(2)
      expect(result.receiverCredits).toBe(4)
    })

    it('자기 자신에게 선물하면 에러를 던진다', async () => {
      await expect(useCase.gift('author-1', 'author-1', 1)).rejects.toThrow('자기 자신에게')
    })

    it('선물 금액이 0 이하이면 에러를 던진다', async () => {
      await expect(useCase.gift('author-1', 'author-2', 0)).rejects.toThrow('양수')
    })

    it('크레딧이 부족하면 에러를 던진다', async () => {
      mockAuthorRepo.findById.mockResolvedValue({ ...mockAuthor, credits: 0 })
      await expect(useCase.gift('author-1', 'author-2', 1)).rejects.toThrow('크레딧이 부족합니다')
    })

    it('받는 유저가 없으면 에러를 던진다', async () => {
      mockAuthorRepo.findById
        .mockResolvedValueOnce(mockAuthor)
        .mockResolvedValueOnce(null)
      await expect(useCase.gift('author-1', 'no-one', 1)).rejects.toThrow('받는 유저')
    })
  })

  describe('getGiftRanking', () => {
    it('응원받는 작가 랭킹을 반환한다', async () => {
      const ranking = await useCase.getGiftRanking(10)
      expect(ranking).toHaveLength(1)
      expect(ranking[0].totalGifted).toBe(10)
    })
  })
})
