import { CreditUseCase } from './credit.usecase'

/**
 * 크레딧 개편 CC-4 Phase 3 (2026-05-21) — `CreditRepositoryPort` DI 제거 정합.
 *
 * Phase 1 폐기 spec (제거 완료):
 *   - describe('deduct') — `Author.credits` Int 차감 (구 경로)
 *   - describe('grant') — `Author.credits` Int 적립 (구 경로)
 *   - describe('getBalance') — `Author.credits` Int 단일 잔액 (구 경로)
 *
 * Phase 3 폐기 spec (제거 — 2026-05-21):
 *   - `creditRepo`/`mockCreditRepo` mock 전체 — `CreditRepositoryPort` DI 자체 제거.
 *   - `getLogs`/`getGiftRanking` ledger 미주입 폴백 case — `ledger` Required 강제 (미주입 시 BadRequest).
 *
 * 잔존 spec 4 메서드는 전부 신 시스템 단일 경로 검증:
 *   - getPointBalance (CreditLedgerPort.getBalance + lazy 안전망)
 *   - gift (CreditLedgerPort.transfer)
 *   - getGiftRanking (CreditLedgerPort.getGiftRanking 단일 경로)
 *   - getLogs (CreditLedgerPort.findByAuthor 단일 경로)
 */
describe('CreditUseCase', () => {
  let useCase: CreditUseCase
  let mockAuthorRepo: { findById: jest.Mock; findBySlug: jest.Mock; findByEmail: jest.Mock; create: jest.Mock }

  const mockAuthor = { id: 'author-1', slug: 'test', name: '테스트', email: 'test@test.com', createdAt: new Date() }

  beforeEach(() => {
    mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue(mockAuthor),
      findBySlug: jest.fn(), findByEmail: jest.fn(), create: jest.fn(),
    }

    // CC-4 Phase 3 — `creditRepo` 인자 제거. ledger Required 강제는 각 it 안에서 검증.
    useCase = new CreditUseCase(mockAuthorRepo as any)
  })

  describe('getPointBalance', () => {
    const mockBalance = {
      free: 3000, subscription: 0, gift: 2000, charged: 5000,
      total: 10000, deficit: 0, available: 10000,
    }

    it('CreditLedgerPort 주입 시 4 출처 포인트 잔액을 반환한다', async () => {
      const mockLedger = { getBalance: jest.fn().mockResolvedValue(mockBalance) }
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)

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
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)
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
        const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)
        await uc.getPointBalance('author-1')
        // membershipRepo 가 없으니 잔액 조회만 진행 (정상 동작)
        expect(mockLedger.getBalance).toHaveBeenCalled()
      })
    })
  })

  describe('getLogs', () => {
    it('CC-4 Phase 3 — ledger 미주입 시 BadRequest (구 creditRepo 폴백 제거)', async () => {
      await expect(useCase.getLogs('author-1')).rejects.toThrow('포인트 원장이 구성되지 않았습니다')
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
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)
      const logs = await uc.getLogs('author-1')
      expect(mockLedger.findByAuthor).toHaveBeenCalledWith('author-1', 100)
      expect(logs).toHaveLength(1)
      expect((logs[0] as any).source).toBe('gift')
    })

    // F-21 (brightMall #1) — 기간/페이지 필터 확장 + 하위호환
    it('F-21 — 무파라미터/무필터 옵션 시 기존 2-인자 호출 유지 (하위호환)', async () => {
      const mockLedger = { getBalance: jest.fn(), findByAuthor: jest.fn().mockResolvedValue([]) }
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)
      // 빈 옵션 객체도 필터로 취급하지 않는다 (limit/from/to/offset 전부 미지정)
      await uc.getLogs('author-1', {})
      expect(mockLedger.findByAuthor).toHaveBeenCalledWith('author-1', 100)
      expect(mockLedger.findByAuthor).toHaveBeenCalledTimes(1)
    })

    it('F-21 — from/to/offset 지정 시 3-인자(filter) 호출로 위임한다', async () => {
      const mockLedger = { getBalance: jest.fn(), findByAuthor: jest.fn().mockResolvedValue([]) }
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)
      const from = new Date('2026-06-01T00:00:00.000Z')
      const to = new Date('2026-07-01T00:00:00.000Z')
      await uc.getLogs('author-1', { from, to, limit: 20, offset: 40 })
      expect(mockLedger.findByAuthor).toHaveBeenCalledWith('author-1', 20, { from, to, offset: 40 })
    })

    it('F-21 — limit 은 100 상한으로 클램프된다 (대량 스크레이핑 방지)', async () => {
      const mockLedger = { getBalance: jest.fn(), findByAuthor: jest.fn().mockResolvedValue([]) }
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)
      await uc.getLogs('author-1', { limit: 5000, offset: 10 })
      expect(mockLedger.findByAuthor).toHaveBeenCalledWith('author-1', 100, {
        from: undefined,
        to: undefined,
        offset: 10,
      })
    })
  })

  // F-21 (brightMall #1) — 구독 풀 만료 예정 요약
  describe('getSubscriptionExpiry', () => {
    const activePlan = {
      id: 'plan-1',
      authorId: 'author-1',
      tier: 'pro',
      monthlyPoolPoints: 93000,
      poolBalance: 40000,
      poolResetAt: new Date('2026-08-01T00:00:00.000Z'),
      startedAt: new Date(),
      expiresAt: null,
      polarSubscriptionId: null,
      status: 'active',
    }

    it('활성 유료 구독은 현재 구독 잔액 + poolResetAt 요약을 반환한다', async () => {
      const mockLedger = {
        getBalance: jest.fn().mockResolvedValue({
          free: 0, subscription: 40000, gift: 0, charged: 0,
          total: 40000, deficit: 0, available: 40000,
        }),
        findByAuthor: jest.fn(),
      }
      const mockMembership = { getPlan: jest.fn().mockResolvedValue(activePlan) }
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any, mockMembership as any)

      const result = await uc.getSubscriptionExpiry('author-1')

      expect(result).toEqual({ expiringAmount: 40000, expiresAt: activePlan.poolResetAt })
      expect(mockMembership.getPlan).toHaveBeenCalledWith('author-1')
    })

    it('MembershipPlanPort 미주입 시 null (BACKWARD COMPATIBLE)', async () => {
      const mockLedger = { getBalance: jest.fn(), findByAuthor: jest.fn() }
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)
      expect(await uc.getSubscriptionExpiry('author-1')).toBeNull()
    })

    it('free 등급/비활성 구독/plan 없음 은 null', async () => {
      const mockLedger = { getBalance: jest.fn(), findByAuthor: jest.fn() }
      const freePlan = { getPlan: jest.fn().mockResolvedValue({ ...activePlan, tier: 'free' }) }
      const cancelled = { getPlan: jest.fn().mockResolvedValue({ ...activePlan, status: 'cancelled' }) }
      const noPlan = { getPlan: jest.fn().mockResolvedValue(null) }

      expect(await new CreditUseCase(mockAuthorRepo as any, mockLedger as any, freePlan as any).getSubscriptionExpiry('author-1')).toBeNull()
      expect(await new CreditUseCase(mockAuthorRepo as any, mockLedger as any, cancelled as any).getSubscriptionExpiry('author-1')).toBeNull()
      expect(await new CreditUseCase(mockAuthorRepo as any, mockLedger as any, noPlan as any).getSubscriptionExpiry('author-1')).toBeNull()
      // getBalance 는 만료 대상 아닐 때 호출조차 안 함 (조기 반환)
      expect(mockLedger.getBalance).not.toHaveBeenCalled()
    })

    it('구독 잔액이 0 이하이면 null (소멸 예정 없음)', async () => {
      const mockLedger = {
        getBalance: jest.fn().mockResolvedValue({
          free: 3000, subscription: 0, gift: 0, charged: 0,
          total: 3000, deficit: 0, available: 3000,
        }),
        findByAuthor: jest.fn(),
      }
      const mockMembership = { getPlan: jest.fn().mockResolvedValue(activePlan) }
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any, mockMembership as any)
      expect(await uc.getSubscriptionExpiry('author-1')).toBeNull()
    })

    it('ledger 미주입 시 BadRequest', async () => {
      await expect(useCase.getSubscriptionExpiry('author-1')).rejects.toThrow('포인트 원장이 구성되지 않았습니다')
    })
  })

  describe('gift (CC-2b — ledger.transfer 신 경로)', () => {
    const mockReceiver = { id: 'author-2', slug: 'recv', name: '수신자', email: 'recv@test.com', createdAt: new Date() }

    /** ledger.transfer mock + 4 출처 적당히 채운 작가 + useCase 재구성 */
    function setupWithLedger() {
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
        .mockResolvedValueOnce({ ...mockAuthor })  // sender
        .mockResolvedValueOnce(mockReceiver) // receiver
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)
      return { uc, mockLedger }
    }

    it('선물 시 ledger.transfer 단일 트랜잭션을 호출한다 (pt 단위)', async () => {
      const { uc, mockLedger } = setupWithLedger()

      const result = await uc.gift('author-1', 'author-2', 1000)

      expect(mockLedger.transfer).toHaveBeenCalledWith('author-1', 'author-2', 1000, undefined)
      expect(result.receiverGiftBalance).toBe(1000)
      expect(result.senderSpentBySource.charged).toBe(1000)
      // CC-4 Phase 1: 구 giftTransfer port 시그니처 자체가 제거됨 → mock 검증 불가, 호출 0건 자명
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
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)

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
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)
      await expect(uc.gift('author-1', 'no-one', 1000)).rejects.toThrow('받는 유저')
    })

    it('CreditLedgerPort 미주입 시 BadRequest (CC-2b 신 경로 필수)', async () => {
      await expect(useCase.gift('author-1', 'author-2', 1000)).rejects.toThrow('포인트 원장')
    })
  })

  describe('getGiftRanking', () => {
    it('CC-4 Phase 3 — ledger 미주입 시 BadRequest (구 creditRepo 폴백 제거)', async () => {
      await expect(useCase.getGiftRanking(10)).rejects.toThrow('포인트 원장이 구성되지 않았습니다')
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
      const uc = new CreditUseCase(mockAuthorRepo as any, mockLedger as any)
      const ranking = await uc.getGiftRanking(5)
      expect(mockLedger.getGiftRanking).toHaveBeenCalledWith(5)
      expect(ranking).toHaveLength(2)
      expect(ranking[0].authorId).toBe('author-A')
      expect(ranking[0].totalGifted).toBe(9000)
    })
  })
})
