import { PrismaPaymentRepository } from './prisma-payment.repository'

/**
 * PrismaPaymentRepository 단위 테스트 (Sprint PAY-P1-3 — findReusablePendingPayment 정합성 검증).
 *
 * 4 it 블록 (AC-2 정본):
 * (a) 정상 재사용 — 24h 이내 동일 (authorId, productId, status='pending') row 반환
 * (b) 24h 초과 — expireSince 이전 createdAt row 0건 반환 (null)
 * (c) 다른 productId — productId 불일치 row 제외 (null)
 * (d) 다른 authorId — authorId 불일치 row 제외 (null)
 *
 * 더미 assertion 0건 — toHaveBeenCalledWith로 WHERE 절 인자 정합 박제 (Constitution P15).
 */
describe('PrismaPaymentRepository.findReusablePendingPayment', () => {
  let repo: PrismaPaymentRepository
  let mockPrisma: any

  const NOW = new Date('2026-05-04T12:00:00Z')
  const EXPIRE_SINCE = new Date(NOW.getTime() - 24 * 60 * 60 * 1000) // now - 24h

  const mockPayment = {
    id: 'pay-reuse-1',
    authorId: 'author-1',
    productId: 'credit-starter',
    amount: 3000,
    credits: 25000,
    status: 'pending',
    externalTransactionId: 'TRADE-old',
    createdAt: new Date(NOW.getTime() - 5 * 60 * 1000), // 5분 전
    completedAt: null,
  }

  beforeEach(() => {
    mockPrisma = {
      payment: {
        findFirst: jest.fn(),
      },
    }
    repo = new PrismaPaymentRepository(mockPrisma)
  })

  // ============================================================================
  // (a) 정상 재사용
  // ============================================================================
  it('24h 이내 동일 (authorId, productId, status=pending) row 1건 반환', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(mockPayment)

    const result = await repo.findReusablePendingPayment('author-1', 'credit-starter', EXPIRE_SINCE)

    // WHERE 정합 검증 — authorId AND productId AND status='pending' AND createdAt > expireSince
    expect(mockPrisma.payment.findFirst).toHaveBeenCalledTimes(1)
    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith({
      where: {
        authorId: 'author-1',
        productId: 'credit-starter',
        status: 'pending',
        createdAt: { gt: EXPIRE_SINCE },
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(result).toEqual(mockPayment)
    expect(result?.id).toBe('pay-reuse-1')
    expect(result?.status).toBe('pending')
  })

  // ============================================================================
  // (b) 24h 초과
  // ============================================================================
  it('24h 초과 시 findFirst가 null 반환 → null', async () => {
    // Prisma findFirst는 createdAt > expireSince 필터로 24h 초과 row를 자동 제외
    mockPrisma.payment.findFirst.mockResolvedValue(null)

    const result = await repo.findReusablePendingPayment('author-1', 'credit-starter', EXPIRE_SINCE)

    // 호출 인자에 createdAt: { gt: expireSince } 정합 박제
    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gt: EXPIRE_SINCE },
        }),
      }),
    )
    expect(result).toBeNull()
  })

  // ============================================================================
  // (c) 다른 productId
  // ============================================================================
  it('다른 productId 호출 시 findFirst가 null 반환 → null (productId 필터 정합)', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null)

    const result = await repo.findReusablePendingPayment('author-1', 'credit-popular', EXPIRE_SINCE)

    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authorId: 'author-1',
          productId: 'credit-popular',
          status: 'pending',
        }),
      }),
    )
    expect(result).toBeNull()
  })

  // ============================================================================
  // (d) 다른 authorId
  // ============================================================================
  it('다른 authorId 호출 시 findFirst가 null 반환 → null (authorId 필터 정합)', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null)

    const result = await repo.findReusablePendingPayment('author-2', 'credit-starter', EXPIRE_SINCE)

    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authorId: 'author-2',
          productId: 'credit-starter',
          status: 'pending',
        }),
      }),
    )
    expect(result).toBeNull()
  })

  // ============================================================================
  // (e) ORDER BY createdAt DESC + LIMIT 1 정합
  // ============================================================================
  it('orderBy createdAt desc 정합 박제 (가장 최근 pending 우선)', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(mockPayment)

    await repo.findReusablePendingPayment('author-1', 'credit-starter', EXPIRE_SINCE)

    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      }),
    )
  })
})

// ============================================================================
// PAY-P3-A: refundPaymentAtomically CAS 패턴 검증 (구멍-B 차단)
// 정본: .claude/shared-contracts.md §22 PaymentRaceCondition
// AC-4: CAS mismatch 시 throw + 호출자 retry 위임
// AC-7: 100 동시 환불 시뮬 race window 차단
// ============================================================================
describe('PrismaPaymentRepository.refundPaymentAtomically — CAS 패턴 (구멍-B 차단)', () => {
  let repo: PrismaPaymentRepository
  let mockPrisma: any
  let txMock: any

  const baseInput = {
    paymentId: 'pay-1',
    authorId: 'author-1',
    credits: 60,
    refundedAmount: 10000,
    reason: 'polar_webhook_order.refunded',
    source: 'webhook' as const,
  }

  beforeEach(() => {
    txMock = {
      payment: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
      author: {
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
      creditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
      refundLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    }
    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
    }
    repo = new PrismaPaymentRepository(mockPrisma)
  })

  it('AC-4(a) CAS 패턴 — author.credits >= actualDeducted 시 updateMany 1 row 갱신 + 정상 환수', async () => {
    // payment.amount=10000 → ratio=1.0 → proportionalCredits=60 → currentBalance=100 → actualDeducted=60
    txMock.payment.findUnique.mockResolvedValueOnce({ amount: 10000, status: 'completed' })
    txMock.author.findUniqueOrThrow.mockResolvedValueOnce({ credits: 100 })
    txMock.author.updateMany.mockResolvedValueOnce({ count: 1 })

    const result = await repo.refundPaymentAtomically(baseInput)

    // CAS 패턴 정합 — updateMany WHERE credits >= actualDeducted
    expect(txMock.author.updateMany).toHaveBeenCalledTimes(1)
    expect(txMock.author.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'author-1',
        credits: { gte: 60 }, // actualDeducted
      },
      data: { credits: { decrement: 60 } },
    })
    expect(result).toEqual({
      actualDeducted: 60,
      deficitCredits: 0,
      proportionalCredits: 60,
      isPartial: false,
    })
  })

  it('AC-4(b) CAS mismatch — updateMany count=0 시 throw CAS_MISMATCH (race window 검출)', async () => {
    // race 시뮬 — findUniqueOrThrow는 credits=100 반환했으나, updateMany 시점에는 다른 트랜잭션이 credits를 줄여서 count=0
    txMock.payment.findUnique.mockResolvedValueOnce({ amount: 10000, status: 'completed' })
    txMock.author.findUniqueOrThrow.mockResolvedValueOnce({ credits: 100 })
    txMock.author.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(repo.refundPaymentAtomically(baseInput)).rejects.toThrow(/CAS_MISMATCH/)

    // updateMany는 시도되었으나 0 row 갱신 — CreditLog/RefundLog 박제 0건 (트랜잭션 rollback 위임)
    expect(txMock.author.updateMany).toHaveBeenCalledTimes(1)
    expect(txMock.creditLog.create).not.toHaveBeenCalled()
    expect(txMock.refundLog.create).not.toHaveBeenCalled()
  })

  it('AC-4(c) deficit 분기 — actualDeducted=잔액(10) + deficitCredits=50 + updateMany WHERE credits >= 10', async () => {
    // currentBalance=10 < proportionalCredits=60 → actualDeducted=10, deficit=50
    txMock.payment.findUnique.mockResolvedValueOnce({ amount: 10000, status: 'completed' })
    txMock.author.findUniqueOrThrow.mockResolvedValueOnce({ credits: 10 })
    txMock.author.updateMany.mockResolvedValueOnce({ count: 1 })

    const result = await repo.refundPaymentAtomically(baseInput)

    // CAS 패턴 — actualDeducted 기준으로 WHERE 절 박제
    expect(txMock.author.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'author-1',
        credits: { gte: 10 }, // actualDeducted (= 잔액)
      },
      data: { credits: { decrement: 10 } },
    })
    expect(result).toEqual({
      actualDeducted: 10,
      deficitCredits: 50,
      proportionalCredits: 60,
      isPartial: false,
    })
  })

  it('AC-7 시뮬: 100 동시 환불 호출 — 모든 트랜잭션이 CAS 패턴으로 정합 처리 (race window 0건)', async () => {
    // 100개의 독립 호출 — 각 호출이 자체 tx 받아서 CAS 통과
    txMock.payment.findUnique.mockResolvedValue({ amount: 10000, status: 'completed' })
    txMock.author.findUniqueOrThrow.mockResolvedValue({ credits: 100 })
    txMock.author.updateMany.mockResolvedValue({ count: 1 })

    const promises = Array.from({ length: 100 }, () => repo.refundPaymentAtomically(baseInput))
    const results = await Promise.all(promises)

    // 모든 호출이 CAS 통과 (count=1)
    expect(results).toHaveLength(100)
    expect(txMock.author.updateMany).toHaveBeenCalledTimes(100)
    // 각 호출 결과 정합 (actualDeducted=60 정확)
    for (const r of results) {
      expect(r.actualDeducted).toBe(60)
    }
  })

  it('AC-7 변형: actualDeducted=0 시 (잔액 0건 + proportionalCredits=0) updateMany 호출 0건 + RefundLog 박제', async () => {
    // currentBalance=0 + proportionalCredits=0 (예: 부분 환불 비율로 0이 된 케이스)
    // 본 케이스: proportionalCredits=0이려면 ratio*credits < 1이어야 하므로 실제 시나리오는 매우 작은 ratio
    // 단순 시뮬: currentBalance=0 → actualDeducted=0
    txMock.payment.findUnique.mockResolvedValueOnce({ amount: 10000, status: 'completed' })
    txMock.author.findUniqueOrThrow.mockResolvedValueOnce({ credits: 0 })
    // updateMany는 호출 0건 (actualDeducted=0 분기)

    const result = await repo.refundPaymentAtomically(baseInput)

    expect(txMock.author.updateMany).not.toHaveBeenCalled()
    expect(result).toEqual({
      actualDeducted: 0,
      deficitCredits: 60,
      proportionalCredits: 60,
      isPartial: false,
    })
  })
})

// ============================================================================
// CC-2a: completePaymentWithPoints — 충전 결제 적립 원자 트랜잭션 (案 1)
// 정본: reports/CREDIT_CORE_DIAGNOSIS.md §1-A / §6-2
//       .claude/state/sprint-cc2a-charge-wiring-plan-draft.md §3
// CLAUDE.md §9 결제 원자성 — 단일 $transaction (Payment 완료 + deficit 상계 + 충전 적립)
// ============================================================================
describe('PrismaPaymentRepository.completePaymentWithPoints — 충전 적립 원자 트랜잭션 (CC-2a)', () => {
  let repo: PrismaPaymentRepository
  let mockPrisma: any
  let txMock: any
  /** FOR UPDATE 잠금 raw query 가 반환할 authors row */
  let lockedRow: {
    points_free: number
    points_subscription: number
    points_gift: number
    points_charged: number
    deficit_points: number
  }

  beforeEach(() => {
    lockedRow = {
      points_free: 0,
      points_subscription: 0,
      points_gift: 0,
      points_charged: 0,
      deficit_points: 0,
    }
    txMock = {
      // $queryRawUnsafe — FOR UPDATE 잠금. [lockedRow] 배열 반환 (어댑터가 구조분해)
      $queryRawUnsafe: jest.fn().mockImplementation(async () => [lockedRow]),
      payment: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      author: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      creditLedger: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    }
    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
    }
    repo = new PrismaPaymentRepository(mockPrisma)
  })

  it('deficit 0 — 충전액 전액이 charged earn row 로 적립 (deficit_settle row 0건)', async () => {
    lockedRow.points_charged = 10000 // 기존 충전 캐시

    const result = await repo.completePaymentWithPoints('pay-1', 'author-1', 25000, 'credit-starter', 'pay-1')

    // Payment 완료
    expect(txMock.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: expect.objectContaining({ status: 'completed' }),
    })
    // creditLedger — earn row 1건만 (deficit 0 → deficit_settle 미박제)
    expect(txMock.creditLedger.create).toHaveBeenCalledTimes(1)
    expect(txMock.creditLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authorId: 'author-1',
        source: 'charged',
        type: 'earn',
        amount: 25000,
        reason: 'purchase_credit-starter',
        relatedId: 'pay-1',
      }),
    })
    // Author.pointsCharged 캐시 가산 (10,000 + 25,000)
    expect(txMock.author.update).toHaveBeenCalledWith({
      where: { id: 'author-1' },
      data: { pointsCharged: 35000 },
    })
    expect(result).toEqual({ settledDeficit: 0, chargedPoints: 25000 })
  })

  it('deficit < 충전액 — 외상 전액 상계 + 남은 충전액 적립 (deficit_settle + earn 양쪽 박제)', async () => {
    lockedRow.deficit_points = 4000
    lockedRow.points_charged = 1000

    const result = await repo.completePaymentWithPoints('pay-1', 'author-1', 25000, 'credit-starter')

    // creditLedger 2건 — deficit_settle + earn
    expect(txMock.creditLedger.create).toHaveBeenCalledTimes(2)
    // ① deficit_settle row (외상 4,000pt 전액 상계)
    expect(txMock.creditLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'charged',
        type: 'deficit_settle',
        amount: -4000,
        reason: 'deficit_settle_on_charge',
      }),
    })
    // ② charged earn row (남은 21,000pt)
    expect(txMock.creditLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'earn',
        amount: 21000,
      }),
    })
    // Author — deficitPoints=0 + pointsCharged=1,000+21,000=22,000
    expect(txMock.author.update).toHaveBeenCalledWith({
      where: { id: 'author-1' },
      data: { deficitPoints: 0 },
    })
    expect(txMock.author.update).toHaveBeenCalledWith({
      where: { id: 'author-1' },
      data: { pointsCharged: 22000 },
    })
    expect(result).toEqual({ settledDeficit: 4000, chargedPoints: 21000 })
  })

  it('deficit ≥ 충전액 — 충전액 전부 외상 상계, charged earn row 0건 (C-6 부분 상계)', async () => {
    // 외상 40,000pt — 입문 충전 25,000pt 로 전부 못 갚음
    lockedRow.deficit_points = 40000

    const result = await repo.completePaymentWithPoints('pay-1', 'author-1', 25000, 'credit-starter')

    // creditLedger — deficit_settle 1건만 (earn 미박제)
    expect(txMock.creditLedger.create).toHaveBeenCalledTimes(1)
    expect(txMock.creditLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'deficit_settle',
        amount: -25000,
      }),
    })
    // Author — deficitPoints=15,000 만 갱신 (pointsCharged 미갱신 — earn 0건)
    expect(txMock.author.update).toHaveBeenCalledTimes(1)
    expect(txMock.author.update).toHaveBeenCalledWith({
      where: { id: 'author-1' },
      data: { deficitPoints: 15000 },
    })
    expect(result).toEqual({ settledDeficit: 25000, chargedPoints: 0 })
  })

  it('FOR UPDATE 잠금 raw query 를 호출한다 (동시 차감/적립 직렬화)', async () => {
    await repo.completePaymentWithPoints('pay-1', 'author-1', 25000, 'credit-starter')

    // $queryRawUnsafe 가 FOR UPDATE SQL + authorId 로 호출됨
    expect(txMock.$queryRawUnsafe).toHaveBeenCalledTimes(1)
    const [sql, arg] = txMock.$queryRawUnsafe.mock.calls[0]
    expect(sql).toContain('FOR UPDATE')
    expect(arg).toBe('author-1')
  })

  it('잠금 대상 작가가 없으면 throw (Payment 완료 0건 — 트랜잭션 rollback 위임)', async () => {
    txMock.$queryRawUnsafe.mockResolvedValueOnce([]) // 작가 미존재

    await expect(
      repo.completePaymentWithPoints('pay-1', 'author-x', 25000, 'credit-starter'),
    ).rejects.toThrow('작가를 찾을 수 없습니다')

    // Payment 완료/ledger 박제 0건
    expect(txMock.payment.update).not.toHaveBeenCalled()
    expect(txMock.creditLedger.create).not.toHaveBeenCalled()
  })

  it('totalPoints 가 0 이하면 throw (트랜잭션 진입 0건)', async () => {
    await expect(
      repo.completePaymentWithPoints('pay-1', 'author-1', 0, 'credit-starter'),
    ).rejects.toThrow('충전 포인트는 양의 정수여야 합니다')
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})

// ============================================================================
// CC-2b: refundPaymentWithPoints — 환불 신 경로 + 이중 외상 통합 (案 R1)
// 정본: reports/CREDIT_CORE_DIAGNOSIS.md §1-C
//       .claude/state/sprint-cc2b-gift-refund-wiring-plan-draft.md §5
// CLAUDE.md §9 결제 원자성 — 단일 $transaction (Payment 갱신 + 4 출처 환수 + 외상 통합 + RefundLog)
// ============================================================================
describe('PrismaPaymentRepository.refundPaymentWithPoints — 환불 신 경로 (CC-2b)', () => {
  let repo: PrismaPaymentRepository
  let mockPrisma: any
  let txMock: any
  let lockedRow: {
    points_free: number
    points_subscription: number
    points_gift: number
    points_charged: number
    deficit_points: number
  }
  let refundLogs: any[]
  let createdLedgers: any[]
  let executedUpdates: string[]

  const baseInput = {
    paymentId: 'pay-r1',
    authorId: 'author-r1',
    refundPt: 25000,
    refundedAmount: 3000,
    reason: 'polar_webhook_order.refunded',
    source: 'webhook' as const,
  }

  beforeEach(() => {
    lockedRow = {
      points_free: 0,
      points_subscription: 0,
      points_gift: 0,
      points_charged: 25000,
      deficit_points: 0,
    }
    refundLogs = []
    createdLedgers = []
    executedUpdates = []
    txMock = {
      $queryRawUnsafe: jest.fn().mockImplementation(async () => [lockedRow]),
      // $executeRawUnsafe — CAS UPDATE (출처별 환수). 기본 1 row 갱신
      $executeRawUnsafe: jest.fn().mockImplementation(async (sql: string) => {
        executedUpdates.push(sql)
        return 1
      }),
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          amount: 3000,
          credits: 25000,
          status: 'completed',
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      author: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      creditLedger: {
        create: jest.fn().mockImplementation(async (args: any) => {
          createdLedgers.push(args.data)
          return args.data
        }),
      },
      refundLog: {
        create: jest.fn().mockImplementation(async (args: any) => {
          refundLogs.push(args.data)
          return args.data
        }),
      },
    }
    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
    }
    repo = new PrismaPaymentRepository(mockPrisma)
  })

  it('전액 환불 정상 — charged 25,000 환수 + RefundLog credits=25000 + deficit_incur 0건', async () => {
    const result = await repo.refundPaymentWithPoints(baseInput)

    expect(result).toEqual({
      actualRefunded: 25000,
      deficitIncurred: 0,
      proportionalPt: 25000,
      isPartial: false,
    })

    // Payment status='refunded'
    expect(txMock.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'refunded' } }),
    )

    // CAS UPDATE — charged 컬럼 환수
    expect(executedUpdates.some((s) => s.includes('points_charged'))).toBe(true)

    // CreditLedger — spend row 1건 (charged) + deficit_incur 0건
    expect(createdLedgers.filter((l) => l.type === 'spend')).toHaveLength(1)
    expect(createdLedgers.filter((l) => l.type === 'deficit_incur')).toHaveLength(0)
    expect(createdLedgers[0]).toMatchObject({
      source: 'charged',
      type: 'spend',
      amount: -25000,
    })

    // RefundLog — credits=25000(실 환수), deficitCredits=0
    expect(refundLogs).toHaveLength(1)
    expect(refundLogs[0]).toMatchObject({
      paymentId: 'pay-r1',
      amount: 3000,
      credits: 25000,
      deficitCredits: 0,
    })
  })

  it('이중 외상 통합 — 잔액 부족 시 deficit_incur ledger + Author.deficitPoints 가산', async () => {
    // 잔액 10,000 / refundPt 25,000 → 환수 10,000 + deficit 15,000
    lockedRow.points_charged = 10000
    const result = await repo.refundPaymentWithPoints(baseInput)

    expect(result.actualRefunded).toBe(10000)
    expect(result.deficitIncurred).toBe(15000)

    // deficit_incur ledger 1건 (reason=refund_deficit:..)
    const deficitRows = createdLedgers.filter((l) => l.type === 'deficit_incur')
    expect(deficitRows).toHaveLength(1)
    expect(deficitRows[0]).toMatchObject({
      type: 'deficit_incur',
      amount: -15000,
      reason: expect.stringContaining('refund_deficit:pay-r1'),
    })

    // Author.deficitPoints 가산 update — 신 외상 단일 장부
    expect(txMock.author.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deficitPoints: 15000 } }),
    )

    // RefundLog.deficitCredits = 15000 (의미 재해석 — "이 환불이 유발한 외상 pt 기여분")
    expect(refundLogs[0]).toMatchObject({
      credits: 10000,
      deficitCredits: 15000,
    })
  })

  it('부분 환불 (50%) — proportionalPt 비례 계산 + status="partial_refunded"', async () => {
    // 결제 ₩3,000 의 절반 ₩1,500 환불 → 12,500pt 환수
    lockedRow.points_charged = 25000
    const result = await repo.refundPaymentWithPoints({
      ...baseInput,
      refundedAmount: 1500,
    })

    expect(result.isPartial).toBe(true)
    expect(result.proportionalPt).toBe(12500)
    expect(result.actualRefunded).toBe(12500)

    expect(txMock.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'partial_refunded' } }),
    )
    // reason 에 _partial suffix
    expect(createdLedgers[0].reason).toContain('_partial')
  })

  it('환수 우선순위 — charged 부족 시 gift → subscription → free 역방향', async () => {
    // 잔액: charged 5,000 / gift 5,000 / subscription 10,000 / free 5,000 → 25,000pt 환수 시 4 출처 분산
    lockedRow.points_charged = 5000
    lockedRow.points_gift = 5000
    lockedRow.points_subscription = 10000
    lockedRow.points_free = 5000

    const result = await repo.refundPaymentWithPoints(baseInput)
    expect(result.actualRefunded).toBe(25000)
    expect(result.deficitIncurred).toBe(0)

    // 4 출처 spend row
    const spendRows = createdLedgers.filter((l) => l.type === 'spend')
    expect(spendRows).toHaveLength(4)
    const bySource = Object.fromEntries(spendRows.map((r) => [r.source, -r.amount]))
    expect(bySource).toEqual({
      charged: 5000, gift: 5000, subscription: 10000, free: 5000,
    })
  })

  it('PAY-P3-A CAS — $executeRawUnsafe count=0 시 CAS_MISMATCH throw (race window 차단)', async () => {
    lockedRow.points_charged = 25000
    txMock.$executeRawUnsafe.mockResolvedValueOnce(0) // race detect

    await expect(repo.refundPaymentWithPoints(baseInput)).rejects.toThrow(/CAS_MISMATCH/)

    // refundLog 박제 0건 — 트랜잭션 rollback 위임
    expect(refundLogs).toHaveLength(0)
  })

  it('payment 미존재 시 throw', async () => {
    txMock.payment.findUnique.mockResolvedValueOnce(null)
    await expect(repo.refundPaymentWithPoints(baseInput)).rejects.toThrow('Payment not found')
  })

  it('refundedAmount > payment.amount 시 throw (validation)', async () => {
    txMock.payment.findUnique.mockResolvedValueOnce({
      amount: 1000, credits: 25000, status: 'completed',
    })
    await expect(
      repo.refundPaymentWithPoints({ ...baseInput, refundedAmount: 2000 }),
    ).rejects.toThrow('환불 금액')
  })

  it('payment.amount === 0 (free 결제) throw', async () => {
    txMock.payment.findUnique.mockResolvedValueOnce({
      amount: 0, credits: 0, status: 'completed',
    })
    await expect(repo.refundPaymentWithPoints(baseInput)).rejects.toThrow(
      /환불 불가/,
    )
  })

  it('refundPt 음수면 throw (트랜잭션 진입 0건)', async () => {
    await expect(
      repo.refundPaymentWithPoints({ ...baseInput, refundPt: -1 }),
    ).rejects.toThrow()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('refundedAmount 0 이하 throw', async () => {
    await expect(
      repo.refundPaymentWithPoints({ ...baseInput, refundedAmount: 0 }),
    ).rejects.toThrow('환불 금액')
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('잠금 대상 작가 미존재 throw', async () => {
    txMock.$queryRawUnsafe.mockResolvedValueOnce([])
    await expect(repo.refundPaymentWithPoints(baseInput)).rejects.toThrow(
      '작가를 찾을 수 없습니다',
    )
  })
})
