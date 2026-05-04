import { PaymentCleanupJob } from './payment-cleanup.job'
import { PaymentRepositoryPort } from '@domain/port/outbound/payment-repository.port'
import { AuditLogService } from '@application/admin/audit-log.service'

/**
 * PaymentCleanupJob 단위 테스트 (Sprint PAY-P1-3 — AC-4 정본).
 *
 * 6 it 블록:
 * (a) 24h 초과 pending 1건 → expirePayment 1회 + AuditLog 'payment_expire' 박제
 * (b) 24h 초과 pending 다건 → 모두 expire + AuditLog 다건 박제
 * (c) 빈 stale pending → 모든 mock 0회 (안전 종료)
 * (d) 동시 실행 시 lock 차단 (두 번째 호출 즉시 return)
 * (e) PAYMENT_CLEANUP_DISABLED=1 환경변수 시 즉시 return (findPendingPaymentsOlderThan 0회)
 * (f) 일부 row expire 실패해도 다른 row 처리 계속 (회복력)
 *
 * 더미 assertion 0건 — toHaveBeenCalledWith로 인자 정합 박제 (Constitution P15).
 */
describe('PaymentCleanupJob', () => {
  let job: PaymentCleanupJob
  let mockPaymentRepo: jest.Mocked<PaymentRepositoryPort>
  let mockAuditLog: jest.Mocked<AuditLogService>

  beforeEach(() => {
    mockPaymentRepo = {
      create: jest.fn(),
      findByExternalTransactionId: jest.fn(),
      updateExternalTransactionId: jest.fn(),
      findByAuthorId: jest.fn(),
      completePaymentAtomically: jest.fn(),
      updateStatus: jest.fn(),
      findPendingPaymentsOlderThan: jest.fn().mockResolvedValue([]),
      expirePayment: jest.fn().mockResolvedValue(undefined),
      refundPaymentAtomically: jest.fn(),
      findReusablePendingPayment: jest.fn(),
    } as unknown as jest.Mocked<PaymentRepositoryPort>

    mockAuditLog = {
      log: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn(),
    } as unknown as jest.Mocked<AuditLogService>

    job = new PaymentCleanupJob(mockPaymentRepo, mockAuditLog)
  })

  // ============================================================================
  // (a) 정상 만료 1건
  // ============================================================================
  it('24h 초과 pending 1건 → expirePayment 1회 + AuditLog operator=system_cleanup action=payment_expire 박제', async () => {
    const NOW_MS = Date.now()
    const stale = {
      id: 'pay-stale-1',
      authorId: 'author-1',
      productId: 'credit-5',
      amount: 2000,
      credits: 5,
      status: 'pending',
      externalTransactionId: 'TRADE-stale',
      createdAt: new Date(NOW_MS - 25 * 60 * 60 * 1000), // 25h 전
      completedAt: null,
    }
    mockPaymentRepo.findPendingPaymentsOlderThan.mockResolvedValueOnce([stale])

    await job.cleanupExpiredPendingPayments()

    // findPendingPaymentsOlderThan 24h 인자 정합
    expect(mockPaymentRepo.findPendingPaymentsOlderThan).toHaveBeenCalledTimes(1)
    expect(mockPaymentRepo.findPendingPaymentsOlderThan).toHaveBeenCalledWith(24)

    // expirePayment 1회 (paymentId 인자)
    expect(mockPaymentRepo.expirePayment).toHaveBeenCalledTimes(1)
    expect(mockPaymentRepo.expirePayment).toHaveBeenCalledWith('pay-stale-1')

    // AuditLog operator='system_cleanup' + action='payment_expire' + detail 정합
    expect(mockAuditLog.log).toHaveBeenCalledTimes(1)
    expect(mockAuditLog.log).toHaveBeenCalledWith(
      'system_cleanup',
      'payment_expire',
      'pay-stale-1',
      expect.objectContaining({
        reason: 'pending_24h_cleanup',
        authorId: 'author-1',
        productId: 'credit-5',
        elapsedHours: expect.any(Number),
      }),
    )
    // elapsedHours가 25h 근처 (±1h 허용)
    const auditDetail = mockAuditLog.log.mock.calls[0][3] as { elapsedHours: number }
    expect(auditDetail.elapsedHours).toBeGreaterThanOrEqual(24)
    expect(auditDetail.elapsedHours).toBeLessThan(26)
  })

  // ============================================================================
  // (b) 다건 만료
  // ============================================================================
  it('24h 초과 pending 다건 → 모두 expire 처리 + AuditLog 다건 박제', async () => {
    const NOW_MS = Date.now()
    mockPaymentRepo.findPendingPaymentsOlderThan.mockResolvedValueOnce([
      {
        id: 'pay-stale-a',
        authorId: 'author-a',
        productId: 'credit-5',
        amount: 2000,
        credits: 5,
        status: 'pending',
        externalTransactionId: 'TRADE-a',
        createdAt: new Date(NOW_MS - 25 * 60 * 60 * 1000),
        completedAt: null,
      },
      {
        id: 'pay-stale-b',
        authorId: 'author-b',
        productId: 'credit-20',
        amount: 3000,
        credits: 20,
        status: 'pending',
        externalTransactionId: 'TRADE-b',
        createdAt: new Date(NOW_MS - 30 * 60 * 60 * 1000),
        completedAt: null,
      },
    ])

    await job.cleanupExpiredPendingPayments()

    expect(mockPaymentRepo.expirePayment).toHaveBeenCalledTimes(2)
    expect(mockPaymentRepo.expirePayment).toHaveBeenNthCalledWith(1, 'pay-stale-a')
    expect(mockPaymentRepo.expirePayment).toHaveBeenNthCalledWith(2, 'pay-stale-b')
    expect(mockAuditLog.log).toHaveBeenCalledTimes(2)
    expect(mockAuditLog.log).toHaveBeenNthCalledWith(
      1,
      'system_cleanup',
      'payment_expire',
      'pay-stale-a',
      expect.objectContaining({ authorId: 'author-a', productId: 'credit-5' }),
    )
    expect(mockAuditLog.log).toHaveBeenNthCalledWith(
      2,
      'system_cleanup',
      'payment_expire',
      'pay-stale-b',
      expect.objectContaining({ authorId: 'author-b', productId: 'credit-20' }),
    )
  })

  // ============================================================================
  // (c) 빈 stale pending — 안전 종료
  // ============================================================================
  it('빈 stale pending → expirePayment / AuditLog 0회 + findPendingPaymentsOlderThan 1회', async () => {
    mockPaymentRepo.findPendingPaymentsOlderThan.mockResolvedValueOnce([])

    await job.cleanupExpiredPendingPayments()

    expect(mockPaymentRepo.findPendingPaymentsOlderThan).toHaveBeenCalledTimes(1)
    expect(mockPaymentRepo.expirePayment).not.toHaveBeenCalled()
    expect(mockAuditLog.log).not.toHaveBeenCalled()
  })

  // ============================================================================
  // (d) 동시 실행 lock 차단
  // ============================================================================
  it('동시 실행 시 두 번째 호출은 lock으로 즉시 return (findPendingPaymentsOlderThan 1회만 호출)', async () => {
    let resolveFirst!: (val: unknown) => void
    const firstPromise = new Promise<unknown>((resolve) => {
      resolveFirst = resolve
    })
    mockPaymentRepo.findPendingPaymentsOlderThan.mockImplementationOnce(
      async () => (await firstPromise) as never,
    )

    const firstRun = job.cleanupExpiredPendingPayments()
    // 두 번째 호출 — 첫 호출이 진행 중이므로 즉시 return
    const secondRun = job.cleanupExpiredPendingPayments()
    await secondRun

    // 두 번째 호출은 findPendingPaymentsOlderThan 안 부름
    expect(mockPaymentRepo.findPendingPaymentsOlderThan).toHaveBeenCalledTimes(1)

    // 첫 호출 마무리
    resolveFirst([])
    await firstRun

    // 첫 호출만 호출
    expect(mockPaymentRepo.findPendingPaymentsOlderThan).toHaveBeenCalledTimes(1)
  })

  // ============================================================================
  // (e) PAYMENT_CLEANUP_DISABLED=1 즉시 return
  // ============================================================================
  it('PAYMENT_CLEANUP_DISABLED=1 환경변수 시 즉시 return (findPendingPaymentsOlderThan 0회)', async () => {
    const original = process.env.PAYMENT_CLEANUP_DISABLED
    process.env.PAYMENT_CLEANUP_DISABLED = '1'

    try {
      await job.cleanupExpiredPendingPayments()

      expect(mockPaymentRepo.findPendingPaymentsOlderThan).not.toHaveBeenCalled()
      expect(mockPaymentRepo.expirePayment).not.toHaveBeenCalled()
      expect(mockAuditLog.log).not.toHaveBeenCalled()
    } finally {
      if (original === undefined) {
        delete process.env.PAYMENT_CLEANUP_DISABLED
      } else {
        process.env.PAYMENT_CLEANUP_DISABLED = original
      }
    }
  })

  // ============================================================================
  // (f) 일부 expire 실패해도 다른 row 처리 계속 (회복력)
  // ============================================================================
  it('일부 row expirePayment 실패 시 다른 row 처리 계속 (전체 cron 회복력)', async () => {
    const NOW_MS = Date.now()
    mockPaymentRepo.findPendingPaymentsOlderThan.mockResolvedValueOnce([
      {
        id: 'pay-fail',
        authorId: 'author-fail',
        productId: 'credit-5',
        amount: 2000,
        credits: 5,
        status: 'pending',
        externalTransactionId: 'TRADE-fail',
        createdAt: new Date(NOW_MS - 25 * 60 * 60 * 1000),
        completedAt: null,
      },
      {
        id: 'pay-ok',
        authorId: 'author-ok',
        productId: 'credit-5',
        amount: 2000,
        credits: 5,
        status: 'pending',
        externalTransactionId: 'TRADE-ok',
        createdAt: new Date(NOW_MS - 26 * 60 * 60 * 1000),
        completedAt: null,
      },
    ])
    // 첫 row만 실패
    mockPaymentRepo.expirePayment
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce(undefined)

    await job.cleanupExpiredPendingPayments()

    // expirePayment 두 row 모두 시도 (회복력)
    expect(mockPaymentRepo.expirePayment).toHaveBeenCalledTimes(2)
    expect(mockPaymentRepo.expirePayment).toHaveBeenNthCalledWith(1, 'pay-fail')
    expect(mockPaymentRepo.expirePayment).toHaveBeenNthCalledWith(2, 'pay-ok')

    // AuditLog는 성공한 row만 박제 (1회)
    expect(mockAuditLog.log).toHaveBeenCalledTimes(1)
    expect(mockAuditLog.log).toHaveBeenCalledWith(
      'system_cleanup',
      'payment_expire',
      'pay-ok',
      expect.objectContaining({ authorId: 'author-ok' }),
    )
  })
})
