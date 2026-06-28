import { PaymentReconciliationJob } from './payment-reconciliation.job'
import { PaymentGatewayPort } from '@domain/port/outbound/payment-gateway.port'
import { PaymentRepositoryPort } from '@domain/port/outbound/payment-repository.port'
import { ReconciliationCheckpointRepositoryPort } from '@domain/port/outbound/reconciliation-checkpoint-repository.port'
import { AuditLogService } from '@application/admin/audit-log.service'

/**
 * PaymentReconciliationJob 단위 테스트 (Sprint PAY-P0-2 — AC-3/AC-4/AC-5).
 *
 * 8 it 블록:
 * (a) S1 boost: PG=succeeded + DB=pending → completePaymentAtomically 1회
 * (b) S2 mismatch: PG=refunded + DB=completed → logger.warn + AuditLog 1회 (boost 0회)
 * (c) S3 expire: PG=NotFound + DB=pending(24h) → expirePayment 1회
 * (d) S4 정합: PG=succeeded + DB=completed → 모든 mock 0회 (skip)
 * (e) 동시 실행 시 두 번째 호출 lock 차단
 * (f) 예외 발생 시 lock 해제 + checkpoint errorMessage 박제
 * (g) checkpoint lastRunAt 갱신 (cron 시작 시각 박제)
 * (h) 빈 list 응답 + 빈 stale pending 시 안전 종료
 */
describe('PaymentReconciliationJob', () => {
  let job: PaymentReconciliationJob
  let mockPaymentGateway: jest.Mocked<PaymentGatewayPort>
  let mockPaymentRepo: jest.Mocked<PaymentRepositoryPort>
  let mockCheckpointRepo: jest.Mocked<ReconciliationCheckpointRepositoryPort>
  let mockAuditLog: jest.Mocked<AuditLogService>

  beforeEach(() => {
    mockPaymentGateway = {
      initiatePayment: jest.fn(),
      verifyAndParseWebhook: jest.fn(),
      listRecentCheckouts: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayPort>

    mockPaymentRepo = {
      create: jest.fn(),
      findByExternalTransactionId: jest.fn(),
      updateExternalTransactionId: jest.fn(),
      findByAuthorId: jest.fn(),
      // CC-2a — webhook 누락 보정은 신 충전 적립 트랜잭션 사용 (구 completePaymentAtomically 제거 — CC-4 P1)
      completePaymentWithPoints: jest
        .fn()
        // 기본 = 승자(alreadyCompleted:false). 동시성 패자 case 는 개별 it 에서 덮어쓴다.
        .mockResolvedValue({ settledDeficit: 0, chargedPoints: 25000, alreadyCompleted: false }),
      // CC-2b — 환불 신 경로 mock (구 refundPaymentAtomically 제거 — CC-4 P1)
      refundPaymentWithPoints: jest.fn(),
      updateStatus: jest.fn(),
      findPendingPaymentsOlderThan: jest.fn(),
      expirePayment: jest.fn(),
      findReusablePendingPayment: jest.fn(),
    } as unknown as jest.Mocked<PaymentRepositoryPort>

    mockCheckpointRepo = {
      findSingleton: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<ReconciliationCheckpointRepositoryPort>

    mockAuditLog = {
      log: jest.fn(),
      findAll: jest.fn(),
    } as unknown as jest.Mocked<AuditLogService>

    job = new PaymentReconciliationJob(
      mockPaymentGateway,
      mockPaymentRepo,
      mockCheckpointRepo,
      mockAuditLog,
    )

    // 기본 checkpoint 응답
    mockCheckpointRepo.findSingleton.mockResolvedValue({
      id: 'singleton',
      lastRunAt: new Date('2026-05-03T00:00:00Z'),
      processedCount: 0,
      boostCount: 0,
      mismatchCount: 0,
      expireCount: 0,
      errorMessage: null,
      updatedAt: new Date('2026-05-03T00:00:00Z'),
    })
    mockCheckpointRepo.update.mockResolvedValue({
      id: 'singleton',
      lastRunAt: new Date(),
      processedCount: 0,
      boostCount: 0,
      mismatchCount: 0,
      expireCount: 0,
      errorMessage: null,
      updatedAt: new Date(),
    })
    // 기본: stale pending 0건
    mockPaymentRepo.findPendingPaymentsOlderThan.mockResolvedValue([])
    // 기본: PG list 0건
    mockPaymentGateway.listRecentCheckouts.mockResolvedValue([])
  })

  // ============================================================================
  // (a) S1 boost
  // ============================================================================
  it('S1 boost: PG=succeeded + DB=pending → completePaymentWithPoints 1회 + AuditLog reconciliation_boost (CC-2a)', async () => {
    const checkoutDate = new Date('2026-05-03T12:00:00Z')
    mockPaymentGateway.listRecentCheckouts.mockResolvedValue([
      {
        externalTransactionId: 'checkout-1',
        status: 'succeeded',
        amount: 3000,
        createdAt: checkoutDate,
      },
    ])
    // CC-2a 디노미 — points 는 충전 총 pt (입문 패키지 25,000pt). [CC-4 Phase 2 rename]
    mockPaymentRepo.findByExternalTransactionId.mockResolvedValue({
      id: 'payment-1',
      authorId: 'author-1',
      productId: 'credit-starter',
      amount: 3000,
      points: 25000,
      status: 'pending',
      externalTransactionId: 'checkout-1',
      createdAt: new Date('2026-05-03T11:00:00Z'),
      completedAt: null,
    })

    await job.run()

    // CC-2a — webhook 누락 보정도 신 completePaymentWithPoints 사용 (구 경로 0건)
    expect(mockPaymentRepo.completePaymentWithPoints).toHaveBeenCalledTimes(1)
    expect(mockPaymentRepo.completePaymentWithPoints).toHaveBeenCalledWith(
      'payment-1',
      'author-1',
      25000,
      'credit-starter',
      'payment-1',
    )
    expect(mockAuditLog.log).toHaveBeenCalledWith(
      'system_reconciliation',
      'reconciliation_boost',
      'payment-1',
      expect.objectContaining({
        reason: 'webhook_missed',
        polarStatus: 'succeeded',
        dbStatus: 'pending',
        totalPoints: 25000,
        chargedPoints: 25000,
        settledDeficit: 0,
      }),
    )
    // expire/mismatch는 호출 안 됨
    expect(mockPaymentRepo.expirePayment).not.toHaveBeenCalled()
    // checkpoint 갱신 boostCount=1
    expect(mockCheckpointRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        boostCount: 1,
        processedCount: 1,
        mismatchCount: 0,
        expireCount: 0,
      }),
    )
  })

  // R1-notify 잔여갭 (2026-06-28) — S1 boost 동시성 패자.
  // S1 탐지(PG=succeeded·DB=pending)와 boost 사이에 webhook 승자가 완료시키면
  // completePaymentWithPoints 가 alreadyCompleted:true 멱등 no-op 반환 → reconciliation_boost
  // AuditLog/boostCount 이중집계를 막아야 한다.
  it('S1 boost 동시성 패자(alreadyCompleted=true) → reconciliation_boost AuditLog 미박제 + boostCount 증가 0 (이중집계 차단)', async () => {
    mockPaymentGateway.listRecentCheckouts.mockResolvedValue([
      {
        externalTransactionId: 'checkout-dup',
        status: 'succeeded',
        amount: 3000,
        createdAt: new Date('2026-05-03T12:00:00Z'),
      },
    ])
    mockPaymentRepo.findByExternalTransactionId.mockResolvedValue({
      id: 'payment-dup',
      authorId: 'author-1',
      productId: 'credit-starter',
      amount: 3000,
      points: 25000,
      status: 'pending', // 탐지 시점에는 pending — boost 진입
      externalTransactionId: 'checkout-dup',
      createdAt: new Date('2026-05-03T11:00:00Z'),
      completedAt: null,
    })
    // boost 진입 후 CAS 패자 — webhook 승자가 이미 완료시킨 상태
    mockPaymentRepo.completePaymentWithPoints.mockResolvedValueOnce({
      settledDeficit: 0,
      chargedPoints: 0,
      alreadyCompleted: true,
    })

    await job.run()

    // completePaymentWithPoints 는 1회 시도됨 (CAS 가 내부에서 패자 판별)
    expect(mockPaymentRepo.completePaymentWithPoints).toHaveBeenCalledTimes(1)
    // 핵심 ① — reconciliation_boost AuditLog 미박제 (보정 안 했는데 보정함 = 이중집계 차단)
    expect(mockAuditLog.log).not.toHaveBeenCalledWith(
      'system_reconciliation',
      'reconciliation_boost',
      expect.anything(),
      expect.anything(),
    )
    // 핵심 ② — boostCount 증가 0 (패자는 카운트하지 않음)
    expect(mockCheckpointRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        boostCount: 0,
        processedCount: 1,
      }),
    )
  })

  // ============================================================================
  // (b) S2 mismatch
  // ============================================================================
  it('S2 mismatch: PG=refunded + DB=completed → AuditLog reconciliation_refund_mismatch + completePaymentAtomically 0회', async () => {
    mockPaymentGateway.listRecentCheckouts.mockResolvedValue([
      {
        externalTransactionId: 'checkout-2',
        status: 'refunded',
        amount: 2000,
        createdAt: new Date('2026-05-03T12:00:00Z'),
      },
    ])
    mockPaymentRepo.findByExternalTransactionId.mockResolvedValue({
      id: 'payment-2',
      authorId: 'author-2',
      productId: 'credit-starter',
      amount: 2000,
      points: 25000,
      status: 'completed',
      externalTransactionId: 'checkout-2',
      createdAt: new Date('2026-05-03T10:00:00Z'),
      completedAt: new Date('2026-05-03T10:01:00Z'),
    })

    await job.run()

    expect(mockPaymentRepo.completePaymentWithPoints).not.toHaveBeenCalled()
    expect(mockPaymentRepo.expirePayment).not.toHaveBeenCalled()
    expect(mockAuditLog.log).toHaveBeenCalledTimes(1)
    expect(mockAuditLog.log).toHaveBeenCalledWith(
      'system_reconciliation',
      'reconciliation_refund_mismatch',
      'payment-2',
      expect.objectContaining({
        reason: 'pg_refunded_db_completed',
        requiresManualRefund: true,
      }),
    )
    expect(mockCheckpointRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        mismatchCount: 1,
        boostCount: 0,
        expireCount: 0,
      }),
    )
  })

  // ============================================================================
  // (c) S3 expire
  // ============================================================================
  it('S3 expire: PG=NotFound + DB=pending(24h 경과) → expirePayment 1회 + AuditLog reconciliation_expire', async () => {
    // PG list 0건 (NotFound 시뮬레이션)
    mockPaymentGateway.listRecentCheckouts.mockResolvedValue([])
    // 24h 경과 pending 1건
    mockPaymentRepo.findPendingPaymentsOlderThan.mockResolvedValue([
      {
        id: 'payment-3',
        authorId: 'author-3',
        productId: 'credit-starter',
        amount: 2000,
        points: 25000,
        status: 'pending',
        externalTransactionId: 'checkout-3',
        createdAt: new Date('2026-05-02T00:00:00Z'),
        completedAt: null,
      },
    ])

    await job.run()

    expect(mockPaymentRepo.expirePayment).toHaveBeenCalledTimes(1)
    expect(mockPaymentRepo.expirePayment).toHaveBeenCalledWith('payment-3')
    expect(mockPaymentRepo.completePaymentWithPoints).not.toHaveBeenCalled()
    expect(mockAuditLog.log).toHaveBeenCalledWith(
      'system_reconciliation',
      'reconciliation_expire',
      'payment-3',
      expect.objectContaining({
        reason: 'pending_24h_no_pg_record',
        dbStatusBefore: 'pending',
        dbStatusAfter: 'expired',
      }),
    )
    expect(mockPaymentRepo.findPendingPaymentsOlderThan).toHaveBeenCalledWith(24)
    expect(mockCheckpointRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        expireCount: 1,
        boostCount: 0,
        mismatchCount: 0,
      }),
    )
  })

  // ============================================================================
  // (d) S4 정합
  // ============================================================================
  it('S4 정합: PG=succeeded + DB=completed → 모든 mock 0회 (skip)', async () => {
    mockPaymentGateway.listRecentCheckouts.mockResolvedValue([
      {
        externalTransactionId: 'checkout-4',
        status: 'succeeded',
        amount: 2000,
        createdAt: new Date('2026-05-03T12:00:00Z'),
      },
    ])
    mockPaymentRepo.findByExternalTransactionId.mockResolvedValue({
      id: 'payment-4',
      authorId: 'author-4',
      productId: 'credit-starter',
      amount: 2000,
      points: 25000,
      status: 'completed', // 정합
      externalTransactionId: 'checkout-4',
      createdAt: new Date('2026-05-03T11:00:00Z'),
      completedAt: new Date('2026-05-03T11:00:30Z'),
    })

    await job.run()

    expect(mockPaymentRepo.completePaymentWithPoints).not.toHaveBeenCalled()
    expect(mockPaymentRepo.expirePayment).not.toHaveBeenCalled()
    expect(mockAuditLog.log).not.toHaveBeenCalled()
    // processedCount는 1, 나머지 카운터 0
    expect(mockCheckpointRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        processedCount: 1,
        boostCount: 0,
        mismatchCount: 0,
        expireCount: 0,
      }),
    )
  })

  // ============================================================================
  // (e) 동시 실행 lock 차단
  // ============================================================================
  it('동시 실행 시 두 번째 호출은 lock으로 즉시 return (listRecentCheckouts 1회만 호출)', async () => {
    // listRecentCheckouts에서 의도적으로 지연 발생 → 첫 호출이 await 동안 두 번째 호출
    let resolveFirst!: (val: unknown) => void
    const firstPromise = new Promise<unknown>((resolve) => {
      resolveFirst = resolve
    })
    mockPaymentGateway.listRecentCheckouts.mockImplementationOnce(
      async () => (await firstPromise) as never,
    )

    const firstRun = job.run()
    // 두 번째 호출 — 첫 호출이 진행 중이므로 즉시 return
    const secondRun = job.run()
    await secondRun

    // 두 번째 호출은 listRecentCheckouts 안 부름
    expect(mockPaymentGateway.listRecentCheckouts).toHaveBeenCalledTimes(1)
    // 두 번째 호출은 checkpoint 미조회 (즉시 return)
    expect(mockCheckpointRepo.findSingleton).toHaveBeenCalledTimes(1)

    // 첫 호출 마무리
    resolveFirst([])
    await firstRun

    // 첫 호출만 listRecentCheckouts 호출 + checkpoint update
    expect(mockPaymentGateway.listRecentCheckouts).toHaveBeenCalledTimes(1)
    expect(mockCheckpointRepo.update).toHaveBeenCalledTimes(1)
  })

  // ============================================================================
  // (f) 예외 발생 시 lock 해제 + checkpoint errorMessage 박제
  // ============================================================================
  it('Polar list API 예외 발생 시 errorMessage 박제 + lock 해제 (다음 호출 가능)', async () => {
    mockPaymentGateway.listRecentCheckouts.mockRejectedValueOnce(
      new Error('rate limit exceeded'),
    )

    await job.run()

    // checkpoint update에 errorMessage 박제
    expect(mockCheckpointRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining('polar_list_failed'),
      }),
    )

    // lock 해제 검증 — 두 번째 run 시 listRecentCheckouts 다시 호출 (정상 동작)
    mockPaymentGateway.listRecentCheckouts.mockResolvedValueOnce([])
    await job.run()
    expect(mockPaymentGateway.listRecentCheckouts).toHaveBeenCalledTimes(2)
  })

  // ============================================================================
  // (g) checkpoint lastRunAt 갱신
  // ============================================================================
  it('checkpoint update 시 lastRunAt에 cron 시작 시각 박제', async () => {
    const beforeRun = Date.now()
    await job.run()
    const afterRun = Date.now()

    expect(mockCheckpointRepo.update).toHaveBeenCalledTimes(1)
    const updateArg = mockCheckpointRepo.update.mock.calls[0][0]
    const lastRunMs = updateArg.lastRunAt.getTime()
    expect(lastRunMs).toBeGreaterThanOrEqual(beforeRun - 100)
    expect(lastRunMs).toBeLessThanOrEqual(afterRun + 100)
  })

  // ============================================================================
  // (h) 빈 응답 안전 종료
  // ============================================================================
  it('빈 PG list + 빈 stale pending → 모든 mock 0회 + checkpoint update만', async () => {
    // 기본 setup: listRecentCheckouts=[] + findPendingPaymentsOlderThan=[]
    await job.run()

    expect(mockPaymentRepo.completePaymentWithPoints).not.toHaveBeenCalled()
    expect(mockPaymentRepo.expirePayment).not.toHaveBeenCalled()
    expect(mockAuditLog.log).not.toHaveBeenCalled()
    expect(mockCheckpointRepo.update).toHaveBeenCalledTimes(1)
    const updateArg = mockCheckpointRepo.update.mock.calls[0][0]
    expect(updateArg.processedCount).toBe(0)
    expect(updateArg.boostCount).toBe(0)
    expect(updateArg.mismatchCount).toBe(0)
    expect(updateArg.expireCount).toBe(0)
    expect(updateArg.errorMessage).toBeNull()
  })

  // ============================================================================
  // 추가: RECONCILIATION_DISABLED=1 시 즉시 return
  // ============================================================================
  it('RECONCILIATION_DISABLED=1 환경변수 시 즉시 return (checkpoint 조회 0회)', async () => {
    const original = process.env.RECONCILIATION_DISABLED
    process.env.RECONCILIATION_DISABLED = '1'

    try {
      await job.run()

      expect(mockCheckpointRepo.findSingleton).not.toHaveBeenCalled()
      expect(mockPaymentGateway.listRecentCheckouts).not.toHaveBeenCalled()
      expect(mockCheckpointRepo.update).not.toHaveBeenCalled()
    } finally {
      if (original === undefined) {
        delete process.env.RECONCILIATION_DISABLED
      } else {
        process.env.RECONCILIATION_DISABLED = original
      }
    }
  })

  // ============================================================================
  // R2 (2026-06-27) — PG↔DB amount mismatch 탐지 안전망.
  // 진단: reports/PAYMENT_DATA_PROCESSING_AUDIT_20260627 §2 #2 (R2).
  // status 조합만 비교하면 R1류 이중적립(동일 status, 잔액만 2배)을 사후 탐지하지 못한다.
  // → PG↔DB amount 불일치 시 AuditLog reconciliation_amount_mismatch 박제 (자동 환수 0건).
  // ============================================================================
  describe('R2 — PG↔DB amount mismatch 탐지', () => {
    it('amount 불일치 + 정합 status(succeeded/completed) → reconciliation_amount_mismatch 1회 (보정 0건)', async () => {
      mockPaymentGateway.listRecentCheckouts.mockResolvedValue([
        {
          externalTransactionId: 'checkout-amt',
          status: 'succeeded',
          amount: 6000, // PG 6,000
          createdAt: new Date('2026-05-03T12:00:00Z'),
        },
      ])
      mockPaymentRepo.findByExternalTransactionId.mockResolvedValue({
        id: 'payment-amt',
        authorId: 'author-amt',
        productId: 'credit-starter',
        amount: 3000, // DB 3,000 — 불일치 (R1류 흔적/금액 괴리)
        points: 25000,
        status: 'completed', // status 는 정합 → 기존 S1/S2 분기 미발동
        externalTransactionId: 'checkout-amt',
        createdAt: new Date('2026-05-03T11:00:00Z'),
        completedAt: new Date('2026-05-03T11:00:30Z'),
      })

      await job.run()

      // amount mismatch AuditLog 1회 — pg/db 금액 + requiresManualReview 박제
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'system_reconciliation',
        'reconciliation_amount_mismatch',
        'payment-amt',
        expect.objectContaining({
          reason: 'pg_db_amount_mismatch',
          pgAmount: 6000,
          dbAmount: 3000,
          requiresManualReview: true,
          authorId: 'author-amt',
        }),
      )
      // 자동 보정 0건 — 환수/적립/만료 미발동 (탐지·기록만)
      expect(mockPaymentRepo.completePaymentWithPoints).not.toHaveBeenCalled()
      expect(mockPaymentRepo.refundPaymentWithPoints).not.toHaveBeenCalled()
      expect(mockPaymentRepo.expirePayment).not.toHaveBeenCalled()
      // checkpoint mismatchCount 에 합산 박제 (status mismatch 0 + amount mismatch 1)
      expect(mockCheckpointRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          processedCount: 1,
          mismatchCount: 1,
          boostCount: 0,
          expireCount: 0,
        }),
      )
    })

    it('amount 불일치 + S1(succeeded/pending) → amount_mismatch 기록 + boost 도 정상 진행 (탐지·보정 독립)', async () => {
      mockPaymentGateway.listRecentCheckouts.mockResolvedValue([
        {
          externalTransactionId: 'checkout-both',
          status: 'succeeded',
          amount: 9999, // PG 금액이 DB 와 다름
          createdAt: new Date('2026-05-03T12:00:00Z'),
        },
      ])
      mockPaymentRepo.findByExternalTransactionId.mockResolvedValue({
        id: 'payment-both',
        authorId: 'author-both',
        productId: 'credit-starter',
        amount: 3000, // 불일치
        points: 25000,
        status: 'pending', // S1 boost 대상
        externalTransactionId: 'checkout-both',
        createdAt: new Date('2026-05-03T11:00:00Z'),
        completedAt: null,
      })

      await job.run()

      // amount mismatch 기록 (continue 하지 않으므로 boost 분기도 통과)
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'system_reconciliation',
        'reconciliation_amount_mismatch',
        'payment-both',
        expect.objectContaining({ reason: 'pg_db_amount_mismatch' }),
      )
      // boost 도 정상 — 적립은 DB payment.points 기준이라 PG amount 괴리와 무관하게 안전
      expect(mockPaymentRepo.completePaymentWithPoints).toHaveBeenCalledTimes(1)
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'system_reconciliation',
        'reconciliation_boost',
        'payment-both',
        expect.objectContaining({ reason: 'webhook_missed' }),
      )
      // mismatchCount(amount 1) + boostCount 1 합산 박제
      expect(mockCheckpointRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          mismatchCount: 1,
          boostCount: 1,
        }),
      )
    })

    it('amount 일치 시 amount_mismatch 0건 (회귀 — 기존 S4 정합 경로 영향 없음)', async () => {
      mockPaymentGateway.listRecentCheckouts.mockResolvedValue([
        {
          externalTransactionId: 'checkout-ok',
          status: 'succeeded',
          amount: 2000,
          createdAt: new Date('2026-05-03T12:00:00Z'),
        },
      ])
      mockPaymentRepo.findByExternalTransactionId.mockResolvedValue({
        id: 'payment-ok',
        authorId: 'author-ok',
        productId: 'credit-starter',
        amount: 2000, // 일치
        points: 25000,
        status: 'completed',
        externalTransactionId: 'checkout-ok',
        createdAt: new Date('2026-05-03T11:00:00Z'),
        completedAt: new Date('2026-05-03T11:00:30Z'),
      })

      await job.run()

      // amount mismatch AuditLog 호출 0건
      const amountMismatchCalls = mockAuditLog.log.mock.calls.filter(
        (c) => c[1] === 'reconciliation_amount_mismatch',
      )
      expect(amountMismatchCalls).toHaveLength(0)
      expect(mockCheckpointRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ mismatchCount: 0 }),
      )
    })
  })
})
