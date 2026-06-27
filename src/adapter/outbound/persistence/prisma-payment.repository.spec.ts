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
    points: 25000,
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
// CC-4 Phase 1 (2026-05-21) — `refundPaymentAtomically` describe 블록 제거.
// 구 메서드(Author.credits Int + CreditLog) 시그니처 + 본문이 port/repository 양측 제거되었음.
// PAY-P3-A CAS race 차단 + PAY-P2-1 부분 환불 비율 회귀는 `refundPaymentWithPoints` 신 메서드
// describe + credit-gift-refund-integration.spec 통합 케이스에서 동등하게 박제.
// ============================================================================

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
        // R1 — Payment 완료는 status CAS(updateMany WHERE status='pending').
        // 기본 count=1 (승자 경로). 동시성 패자(count=0)는 개별 it 에서 덮어쓴다.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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

    // Payment 완료 — status CAS (updateMany WHERE status='pending')
    expect(txMock.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: 'pending' },
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
    expect(txMock.payment.updateMany).not.toHaveBeenCalled()
    expect(txMock.creditLedger.create).not.toHaveBeenCalled()
  })

  it('totalPoints 가 0 이하면 throw (트랜잭션 진입 0건)', async () => {
    await expect(
      repo.completePaymentWithPoints('pay-1', 'author-1', 0, 'credit-starter'),
    ).rejects.toThrow('충전 포인트는 양의 정수여야 합니다')
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  // ==========================================================================
  // R1 (2026-06-27) — status CAS 이중적립 race 봉합.
  // 진단: reports/PAYMENT_DATA_PROCESSING_AUDIT_20260627 §2 #2 (R1).
  //
  // 서로 다른 Polar 이벤트(order.paid/order.updated/checkout.updated)가 모두 success 로
  // 정규화되되 eventId 가 달라 webhook 멱등 게이트를 둘 다 통과 → 두 worker 가 동시에
  // pending 을 읽고 둘 다 적립하면 충전 pt 2배. status CAS(updateMany WHERE status='pending')
  // 가 유일한 동시성 방어 — count===0(패자)이면 적립/잔액 갱신 0회 멱등 no-op.
  //
  // 기존 mock-순차 케이스는 "단일 호출" 만 검증해 진짜 parallel 패자 경로를 입증하지 못했음.
  // 본 describe 는 CAS 0-row 분기를 직접 강제해 "적립 0회 + no-op 반환" 을 단언한다.
  // ==========================================================================
  describe('R1 — status CAS 이중적립 race 봉합 (동시성 패자 = no-op)', () => {
    it('status 가 이미 pending 이 아닐 때(CAS count=0) earn/deficit 적립을 0회 수행하고 no-op 반환', async () => {
      // 동시성 패자 시뮬 — 다른 트랜잭션이 이미 pending→completed 전이시킨 상태.
      // deficit/charged 잔액이 있어도(상계·적립 대상이어도) CAS 0-row 면 일절 손대지 않아야 한다.
      lockedRow.deficit_points = 4000
      lockedRow.points_charged = 1000
      txMock.payment.updateMany.mockResolvedValueOnce({ count: 0 })

      const result = await repo.completePaymentWithPoints(
        'pay-dup',
        'author-1',
        25000,
        'credit-starter',
        'pay-dup',
      )

      // CAS 시도는 1회 (WHERE status='pending')
      expect(txMock.payment.updateMany).toHaveBeenCalledTimes(1)
      expect(txMock.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay-dup', status: 'pending' },
        data: expect.objectContaining({ status: 'completed' }),
      })
      // 핵심 — 적립(earn/deficit_settle) ledger 0건, 잔액(author) 갱신 0건 (중복적립 0)
      expect(txMock.creditLedger.create).not.toHaveBeenCalled()
      expect(txMock.author.update).not.toHaveBeenCalled()
      // 멱등 no-op 반환 (throw 금지 — 이미 처리됨=성공)
      expect(result).toEqual({ settledDeficit: 0, chargedPoints: 0 })
    })

    it('CAS count=1(승자)일 때만 정상 1회 적립 — 회귀 단언 (deficit 0 → earn 1건)', async () => {
      lockedRow.points_charged = 10000
      // 기본 mock 이 count=1 이지만 명시적으로 승자 경로를 박제 (회귀 가드)
      txMock.payment.updateMany.mockResolvedValueOnce({ count: 1 })

      const result = await repo.completePaymentWithPoints(
        'pay-win',
        'author-1',
        25000,
        'credit-starter',
        'pay-win',
      )

      // 정확히 1회 적립 (earn row 1건) — 이중적립 없음
      expect(txMock.creditLedger.create).toHaveBeenCalledTimes(1)
      expect(txMock.creditLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: 'charged',
          type: 'earn',
          amount: 25000,
        }),
      })
      expect(result).toEqual({ settledDeficit: 0, chargedPoints: 25000 })
    })

    it('순차 2회 호출 시뮬 — 1회차 승자(적립 1건) + 2회차 패자(적립 0건) = 누적 earn 1건 (이중적립 0)', async () => {
      // 같은 paymentId 로 두 이벤트가 도달하는 상황을 순차로 재현:
      // 1회차는 pending→completed 전이 성공(count=1), 2회차는 이미 completed 라 count=0.
      lockedRow.points_charged = 0
      txMock.payment.updateMany
        .mockResolvedValueOnce({ count: 1 }) // 1회차 승자
        .mockResolvedValueOnce({ count: 0 }) // 2회차 패자

      const first = await repo.completePaymentWithPoints('pay-x', 'author-1', 25000, 'credit-starter')
      const second = await repo.completePaymentWithPoints('pay-x', 'author-1', 25000, 'credit-starter')

      // earn ledger 누적 1건만 (2회차는 0건) → 충전 pt 2배 방지 입증
      const earnCalls = txMock.creditLedger.create.mock.calls.filter(
        (c: any[]) => c[0].data.type === 'earn',
      )
      expect(earnCalls).toHaveLength(1)
      expect(first).toEqual({ settledDeficit: 0, chargedPoints: 25000 })
      expect(second).toEqual({ settledDeficit: 0, chargedPoints: 0 })
    })
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
  /**
   * PAY-S2 — `tx.refundLog.aggregate` 가 반환할 기존 환불 누적 합계.
   * 기본 0 (해당 paymentId 에 박제된 RefundLog 0건 — 1회차 환불).
   * 누적 한도 케이스에서 it 별로 덮어쓴다.
   */
  let priorRefundedSum: number | null

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
    priorRefundedSum = 0
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
          points: 25000,
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
        // PAY-S2 — 기존 환불 누적 합계 조회 ($transaction 내부 누적 한도 검증).
        // _sum.amount 는 priorRefundedSum (null = RefundLog 0건 → Prisma 의미상 null).
        aggregate: jest.fn().mockImplementation(async () => ({
          _sum: { amount: priorRefundedSum },
        })),
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
    // PAY-S2 — 구 단건 검사(`환불 금액 초과`)는 누적 검증으로 흡수됨.
    // 기존 RefundLog 0건 + 단건 2,000 > payment.amount 1,000 → 누적 검증식이
    // `0 + 2000 > 1000` 으로 동일하게 throw (메시지만 누적 검증 어휘로 통합).
    priorRefundedSum = 0
    txMock.payment.findUnique.mockResolvedValueOnce({
      amount: 1000, points: 25000, status: 'completed',
    })
    await expect(
      repo.refundPaymentWithPoints({ ...baseInput, refundedAmount: 2000 }),
    ).rejects.toThrow('환불 누적 한도 초과')
  })

  it('payment.amount === 0 (free 결제) throw', async () => {
    txMock.payment.findUnique.mockResolvedValueOnce({
      amount: 0, points: 0, status: 'completed',
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

  // ==========================================================================
  // PAY-S2 (HIGH-1) — 다중 부분환불 누적 한도 검증 (depth-in-defense)
  // 정본: shared-contracts §17 PartialRefund / §22 PaymentRaceCondition
  // payment.amount=10,000 시나리오 — 1차 부분환불 후 2차가 누적 초과면 throw.
  // ==========================================================================
  describe('PAY-S2 — 누적 환불 한도 검증', () => {
    /** payment.amount=10,000 으로 고정 (시나리오 정합 — refundPt 도 10,000 비례 기준) */
    const capInput = {
      ...baseInput,
      refundPt: 10000,
    }
    beforeEach(() => {
      // payment.amount=10,000 / charged 잔액 충분 (환수 자체는 통과 가능)
      txMock.payment.findUnique.mockResolvedValue({
        amount: 10000,
        points: 10000,
        status: 'completed',
      })
      lockedRow.points_charged = 100000
    })

    it('① 1차 부분환불 6,000 후 2차 6,000 — 누적 12,000 > 10,000 이므로 throw (적자 차단)', async () => {
      // 기존 RefundLog 누적 6,000 박제된 상태(1차 부분환불 완료) → 2차 6,000 요청
      priorRefundedSum = 6000

      await expect(
        repo.refundPaymentWithPoints({ ...capInput, refundedAmount: 6000 }),
      ).rejects.toThrow('환불 누적 한도 초과')

      // aggregate 가 paymentId WHERE + _sum.amount 로 호출됨 (누적 합산 정합 박제)
      expect(txMock.refundLog.aggregate).toHaveBeenCalledWith({
        where: { paymentId: 'pay-r1' },
        _sum: { amount: true },
      })
      // 한도 초과 — RefundLog 박제 0건 + CAS UPDATE 0건 (트랜잭션 rollback 위임)
      expect(refundLogs).toHaveLength(0)
      expect(executedUpdates).toHaveLength(0)
    })

    it('② 1차 부분환불 6,000 후 2차 4,000 — 누적 10,000 = 10,000 이므로 통과 (한도 내 다회 환불)', async () => {
      // 案 A 검증 — repository 메서드 직접 호출. 누적이 정확히 한도와 같으면 통과.
      priorRefundedSum = 6000

      const result = await repo.refundPaymentWithPoints({
        ...capInput,
        refundedAmount: 4000,
      })

      // 누적 10,000 ≤ 10,000 — 정상 환수 진행
      expect(result.isPartial).toBe(true)
      expect(refundLogs).toHaveLength(1)
      expect(refundLogs[0].amount).toBe(4000)
    })

    it('③ 누적 0 (1회차)에서 단건 초과 — refundedAmount 12,000 > payment.amount 10,000 throw (단건 흡수)', async () => {
      // 기존 RefundLog 0건 — 단건 검사를 누적 검증이 흡수했는지 확인
      priorRefundedSum = null // Prisma aggregate 가 row 0건일 때 반환하는 값

      await expect(
        repo.refundPaymentWithPoints({ ...capInput, refundedAmount: 12000 }),
      ).rejects.toThrow('환불 누적 한도 초과')

      expect(refundLogs).toHaveLength(0)
    })
  })
})
