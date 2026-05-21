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

  describe('getPointBalance', () => {
    const mockBalance = {
      free: 3000, subscription: 0, gift: 2000, charged: 5000,
      total: 10000, deficit: 0, available: 10000,
    }

    it('CreditLedgerPort 주입 시 4 출처 포인트 잔액을 반환한다', async () => {
      const mockLedger = { getBalance: jest.fn().mockResolvedValue(mockBalance) }
      const uc = new CreditUseCase(mockCreditRepo as any, mockAuthorRepo as any, mockLedger as any)

      const balance = await uc.getPointBalance('author-1')

      expect(mockLedger.getBalance).toHaveBeenCalledWith('author-1')
      expect(balance.total).toBe(10000)
      expect(balance.charged).toBe(5000)
      expect(balance.deficit).toBe(0)
    })

    it('CreditLedgerPort 미주입 시 에러를 던진다', async () => {
      await expect(useCase.getPointBalance('author-1')).rejects.toThrow('포인트 원장이 구성되지 않았습니다')
    })

    it('작가가 없으면 에러를 던진다', async () => {
      const mockLedger = { getBalance: jest.fn() }
      const uc = new CreditUseCase(mockCreditRepo as any, mockAuthorRepo as any, mockLedger as any)
      mockAuthorRepo.findById.mockResolvedValue(null)

      await expect(uc.getPointBalance('no-author')).rejects.toThrow('작가를 찾을 수 없습니다')
    })

    describe('CC-3 lazy 안전망 (CRITICAL-1 案 B)', () => {
      it('MembershipPlanPort 주입 시 getBalance 직전에 checkAndResetExpiredPool 호출', async () => {
        const mockLedger = { getBalance: jest.fn().mockResolvedValue(mockBalance) }
        const mockMembership = {
          checkAndResetExpiredPool: jest.fn().mockResolvedValue({ reset: false, plan: null }),
        }
        const uc = new CreditUseCase(
          mockCreditRepo as any,
          mockAuthorRepo as any,
          mockLedger as any,
          mockMembership as any,
        )
        await uc.getPointBalance('author-1')
        expect(mockMembership.checkAndResetExpiredPool).toHaveBeenCalledWith(
          'author-1',
          expect.any(Date),
        )
        expect(mockLedger.getBalance).toHaveBeenCalledWith('author-1')
      })

      it('lazy 호출이 throw 해도 잔액 조회는 진행 (silent log fallback)', async () => {
        const mockLedger = { getBalance: jest.fn().mockResolvedValue(mockBalance) }
        const mockMembership = {
          checkAndResetExpiredPool: jest.fn().mockRejectedValue(new Error('DB error')),
        }
        const uc = new CreditUseCase(
          mockCreditRepo as any,
          mockAuthorRepo as any,
          mockLedger as any,
          mockMembership as any,
        )
        const balance = await uc.getPointBalance('author-1')
        // lazy 실패에도 ledger.getBalance 가 정상 호출됐고 결과 반환
        expect(mockLedger.getBalance).toHaveBeenCalledWith('author-1')
        expect(balance.total).toBe(10000)
      })

      it('MembershipPlanPort 미주입 시 lazy 호출 없음 (BACKWARD COMPATIBLE)', async () => {
        const mockLedger = { getBalance: jest.fn().mockResolvedValue(mockBalance) }
        const uc = new CreditUseCase(mockCreditRepo as any, mockAuthorRepo as any, mockLedger as any)
        await uc.getPointBalance('author-1')
        // membershipRepo 가 없으니 잔액 조회만 진행 (정상 동작)
        expect(mockLedger.getBalance).toHaveBeenCalled()
      })
    })
  })

  describe('getLogs', () => {
    it('ledger 미주입 시 구 creditRepo.findLogsByAuthorId 폴백 (BACKWARD COMPATIBLE)', async () => {
      const logs = await useCase.getLogs('author-1')
      expect(logs).toHaveLength(1)
      expect((logs[0] as any).reason).toBe('theme_generate')
      expect(mockCreditRepo.findLogsByAuthorId).toHaveBeenCalledWith('author-1')
    })

    it('CC-3 (HIGH-3) — ledger 주입 시 findByAuthor 위임 (CreditLedgerEntry[] 반환)', async () => {
      const ledgerEntries = [
        {
          id: 'l-1',
          authorId: 'author-1',
          source: 'gift',
          type: 'earn',
          amount: 1000,
          balanceAfter: 1000,
          expiresAt: null,
          reason: 'gift_received:author-2',
          relatedId: null,
          createdAt: new Date(),
        },
      ]
      const mockLedger = {
        getBalance: jest.fn(),
        findByAuthor: jest.fn().mockResolvedValue(ledgerEntries),
      }
      const uc = new CreditUseCase(mockCreditRepo as any, mockAuthorRepo as any, mockLedger as any)
      const logs = await uc.getLogs('author-1')
      expect(mockLedger.findByAuthor).toHaveBeenCalledWith('author-1', 100)
      // 구 creditRepo.findLogsByAuthorId 미호출
      expect(mockCreditRepo.findLogsByAuthorId).not.toHaveBeenCalled()
      expect(logs).toHaveLength(1)
      expect((logs[0] as any).source).toBe('gift')
    })
  })

  describe('gift (CC-2b — ledger.transfer 신 경로)', () => {
    const mockReceiver = { id: 'author-2', slug: 'recv', name: '수신자', email: 'recv@test.com', credits: 3, createdAt: new Date() }

    /** ledger.transfer mock + 4 출처 적당히 채운 작가 + useCase 재구성 */
    function setupWithLedger(senderCredits = 5000) {
      const mockLedger = {
        getBalance: jest.fn(),
        earn: jest.fn(),
        spend: jest.fn(),
        settleDeficit: jest.fn(),
        findByAuthor: jest.fn(),
        transfer: jest.fn().mockResolvedValue({
          senderSpentBySource: { free: 0, subscription: 0, gift: 0, charged: 1000 },
          receiverGiftBalance: 1000,
        }),
      }
      mockAuthorRepo.findById
        .mockResolvedValueOnce({ ...mockAuthor, credits: senderCredits })  // sender
        .mockResolvedValueOnce(mockReceiver) // receiver
      const uc = new CreditUseCase(mockCreditRepo as any, mockAuthorRepo as any, mockLedger as any)
      return { uc, mockLedger }
    }

    it('선물 시 ledger.transfer 단일 트랜잭션을 호출한다 (pt 단위)', async () => {
      const { uc, mockLedger } = setupWithLedger()

      const result = await uc.gift('author-1', 'author-2', 1000)

      expect(mockLedger.transfer).toHaveBeenCalledWith('author-1', 'author-2', 1000, undefined)
      expect(result.receiverGiftBalance).toBe(1000)
      expect(result.senderSpentBySource.charged).toBe(1000)
      // 구 giftTransfer 는 호출되지 않음
      expect(mockCreditRepo.giftTransfer).not.toHaveBeenCalled()
    })

    it('자기 자신에게 선물하면 BadRequest', async () => {
      const { uc } = setupWithLedger()
      await expect(uc.gift('author-1', 'author-1', 1000)).rejects.toThrow('자기 자신에게')
    })

    it('선물 금액이 0 이하면 BadRequest', async () => {
      const { uc } = setupWithLedger()
      await expect(uc.gift('author-1', 'author-2', 0)).rejects.toThrow('양')
    })

    it('선물 금액이 비정수면 BadRequest', async () => {
      const { uc } = setupWithLedger()
      await expect(uc.gift('author-1', 'author-2', 1000.5)).rejects.toThrow('정수')
    })

    it('포인트 부족 시 BadRequest (외상 선물 불가 — transfer 가 throw)', async () => {
      const mockLedger = {
        getBalance: jest.fn(),
        earn: jest.fn(),
        spend: jest.fn(),
        settleDeficit: jest.fn(),
        findByAuthor: jest.fn(),
        transfer: jest.fn().mockRejectedValue(new Error('포인트가 부족합니다')),
      }
      mockAuthorRepo.findById
        .mockResolvedValueOnce(mockAuthor)
        .mockResolvedValueOnce(mockReceiver)
      const uc = new CreditUseCase(mockCreditRepo as any, mockAuthorRepo as any, mockLedger as any)

      await expect(uc.gift('author-1', 'author-2', 1000)).rejects.toThrow('포인트가 부족')
    })

    it('받는 유저가 없으면 BadRequest', async () => {
      const mockLedger = {
        getBalance: jest.fn(), earn: jest.fn(), spend: jest.fn(),
        settleDeficit: jest.fn(), findByAuthor: jest.fn(), transfer: jest.fn(),
      }
      mockAuthorRepo.findById
        .mockResolvedValueOnce(mockAuthor)
        .mockResolvedValueOnce(null)
      const uc = new CreditUseCase(mockCreditRepo as any, mockAuthorRepo as any, mockLedger as any)
      await expect(uc.gift('author-1', 'no-one', 1000)).rejects.toThrow('받는 유저')
    })

    it('CreditLedgerPort 미주입 시 BadRequest (CC-2b 신 경로 필수)', async () => {
      await expect(useCase.gift('author-1', 'author-2', 1000)).rejects.toThrow('포인트 원장')
    })
  })

  describe('getGiftRanking', () => {
    it('ledger 미주입 시 구 creditRepo.getGiftRanking 폴백 (BACKWARD COMPATIBLE)', async () => {
      const ranking = await useCase.getGiftRanking(10)
      expect(ranking).toHaveLength(1)
      expect(ranking[0].totalGifted).toBe(10)
      expect(mockCreditRepo.getGiftRanking).toHaveBeenCalledWith(10)
    })

    it('CC-3 (HIGH-3) — ledger 주입 시 ledger.getGiftRanking 위임', async () => {
      const mockLedger = {
        getBalance: jest.fn(),
        findByAuthor: jest.fn(),
        getGiftRanking: jest.fn().mockResolvedValue([
          { authorId: 'author-A', totalGifted: 9000 },
          { authorId: 'author-B', totalGifted: 3000 },
        ]),
      }
      const uc = new CreditUseCase(mockCreditRepo as any, mockAuthorRepo as any, mockLedger as any)
      const ranking = await uc.getGiftRanking(5)
      expect(mockLedger.getGiftRanking).toHaveBeenCalledWith(5)
      // 구 경로 미호출
      expect(mockCreditRepo.getGiftRanking).not.toHaveBeenCalled()
      expect(ranking).toHaveLength(2)
      expect(ranking[0].authorId).toBe('author-A')
      expect(ranking[0].totalGifted).toBe(9000)
    })
  })
})
