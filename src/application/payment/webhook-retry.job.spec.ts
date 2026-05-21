import { WebhookRetryJob } from './webhook-retry.job'
import type { WebhookRetryQueueRecord } from '@domain/port/outbound/webhook-retry-queue-repository.port'

/**
 * Sprint PAY-P2-2 WebhookRetryJob spec — 8 it 박제 (정본: shared-contracts §18 + reports/PAY-P2-MASTER-PLAN.md §4).
 *
 * Sprint PAY-P3-C 보강 (2026-05-09) — 사전 dedup 게이트 6 it 신설 (정본: shared-contracts §23 RetryDeduplication).
 *
 * 거짓말 차단 정책:
 * - toBeTruthy 단독 금지 — toHaveBeenCalledWith / toMatchObject ≥6건 강제
 */
describe('WebhookRetryJob (PAY-P2-2)', () => {
  let job: WebhookRetryJob
  let mockRetryQueueRepo: {
    upsert: jest.Mock
    findDue: jest.Mock
    deleteById: jest.Mock
    markRetry: jest.Mock
    findByEventId: jest.Mock
  }
  let mockWebhookEventRepo: {
    findByEventId: jest.Mock
    createIfAbsent: jest.Mock
    markStatus: jest.Mock
  }
  let mockPaymentRepo: {
    findByExternalTransactionId: jest.Mock
  }
  let mockPaymentUseCase: {
    processNormalizedWebhook: jest.Mock
  }
  let mockAuditLog: {
    log: jest.Mock
    findAll: jest.Mock
  }

  const sampleEvent = {
    eventId: 'evt-1',
    type: 'order.completed',
    status: 'success' as const,
    tradeNo: 'tr-1',
    amount: 5000,
  }

  const sampleRecord = (overrides: Partial<WebhookRetryQueueRecord> = {}): WebhookRetryQueueRecord => ({
    id: 'q-1',
    eventId: 'evt-1',
    payload: sampleEvent,
    retryCount: 0,
    lastError: null,
    nextRetryAt: new Date('2026-05-05T01:00:00Z'),
    createdAt: new Date('2026-05-05T00:50:00Z'),
    ...overrides,
  })

  /** PAY-P3-C — payment 조회 결과 픽션 빌더 ([CC-4 Phase 2 rename] points) */
  const samplePayment = (status: string, overrides: Partial<{ id: string }> = {}) => ({
    id: overrides.id ?? 'pay-1',
    authorId: 'author-1',
    productId: 'product-1',
    amount: 5000,
    points: 50,
    status,
    externalTransactionId: 'tr-1',
    createdAt: new Date('2026-05-05T00:00:00Z'),
    completedAt: status === 'completed' ? new Date('2026-05-05T00:30:00Z') : null,
  })

  beforeEach(() => {
    mockRetryQueueRepo = {
      upsert: jest.fn(),
      findDue: jest.fn().mockResolvedValue([]),
      deleteById: jest.fn().mockResolvedValue(undefined),
      markRetry: jest.fn().mockResolvedValue(undefined),
      findByEventId: jest.fn(),
    }
    mockWebhookEventRepo = {
      findByEventId: jest.fn(),
      createIfAbsent: jest.fn(),
      markStatus: jest.fn().mockResolvedValue(undefined),
    }
    mockPaymentRepo = {
      // PAY-P3-C 기본 mock — payment 미존재 (기존 흐름 유지). 각 it에서 필요 시 mockResolvedValueOnce로 override.
      findByExternalTransactionId: jest.fn().mockResolvedValue(null),
    }
    mockPaymentUseCase = {
      processNormalizedWebhook: jest.fn(),
    }
    mockAuditLog = {
      log: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn(),
    }
    job = new WebhookRetryJob(
      mockRetryQueueRepo as never,
      mockWebhookEventRepo as never,
      mockPaymentRepo as never,
      mockPaymentUseCase as never,
      mockAuditLog as never,
    )
    delete process.env.WEBHOOK_RETRY_DISABLED
  })

  it('1/8: nextRetryAt 도래한 row 0건이면 paymentUseCase 호출 0회', async () => {
    mockRetryQueueRepo.findDue.mockResolvedValueOnce([])

    await job.retryDueWebhooks()

    expect(mockRetryQueueRepo.findDue).toHaveBeenCalledTimes(1)
    expect(mockPaymentUseCase.processNormalizedWebhook).not.toHaveBeenCalled()
    expect(mockRetryQueueRepo.deleteById).not.toHaveBeenCalled()
    expect(mockRetryQueueRepo.markRetry).not.toHaveBeenCalled()
  })

  it('2/8: 성공 시 paymentUseCase 호출 + queue row deleteById 호출', async () => {
    const record = sampleRecord()
    mockRetryQueueRepo.findDue.mockResolvedValueOnce([record])
    mockPaymentUseCase.processNormalizedWebhook.mockResolvedValueOnce({
      processed: true,
      credits: 50,
    })

    await job.retryDueWebhooks()

    expect(mockPaymentUseCase.processNormalizedWebhook).toHaveBeenCalledWith(sampleEvent)
    expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledWith('q-1')
    expect(mockRetryQueueRepo.markRetry).not.toHaveBeenCalled()
    expect(mockWebhookEventRepo.markStatus).not.toHaveBeenCalled()
  })

  it('3/8: 실패 시 retryCount++ + lastError + nextRetryAt 백오프 갱신 (markRetry 호출)', async () => {
    const record = sampleRecord({ retryCount: 0 })
    mockRetryQueueRepo.findDue.mockResolvedValueOnce([record])
    mockPaymentUseCase.processNormalizedWebhook.mockRejectedValueOnce(
      new Error('DB connection lost'),
    )

    await job.retryDueWebhooks()

    expect(mockRetryQueueRepo.markRetry).toHaveBeenCalledTimes(1)
    const callArgs = mockRetryQueueRepo.markRetry.mock.calls[0]
    expect(callArgs[0]).toBe('q-1') // id
    expect(callArgs[1]).toBe('DB connection lost') // error message
    // nextRetryAt — 1m 후 (retryCount=1 첫 백오프)
    const nextRetryAt = callArgs[2] as Date
    const minutesAhead = (nextRetryAt.getTime() - Date.now()) / 60_000
    expect(minutesAhead).toBeGreaterThan(0)
    expect(minutesAhead).toBeLessThanOrEqual(2)

    expect(mockRetryQueueRepo.deleteById).not.toHaveBeenCalled()
    expect(mockWebhookEventRepo.markStatus).not.toHaveBeenCalled()
  })

  it('4/8: MAX_RETRY=10 초과 시 permanent_failed 박제 + queue 삭제 + AuditLog operator=system_dlq', async () => {
    const record = sampleRecord({ retryCount: 9 }) // 9 → +1 = 10 → MAX 도달
    mockRetryQueueRepo.findDue.mockResolvedValueOnce([record])
    mockPaymentUseCase.processNormalizedWebhook.mockRejectedValueOnce(
      new Error('persistent error'),
    )

    await job.retryDueWebhooks()

    // permanent_failed 박제 — webhook_events status='failed' 갱신 (이미 failed면 무동작)
    expect(mockWebhookEventRepo.markStatus).toHaveBeenCalledWith(
      'evt-1',
      'failed',
      'persistent error',
    )

    // AuditLog operator=system_dlq + action=webhook_permanent_failed
    expect(mockAuditLog.log).toHaveBeenCalledWith(
      'system_dlq',
      'webhook_permanent_failed',
      'evt-1',
      expect.objectContaining({
        reason: 'max_retry_exceeded',
        maxRetry: 10,
        lastError: 'persistent error',
      }),
    )

    // queue row 삭제 (markRetry 호출 0회)
    expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledWith('q-1')
    expect(mockRetryQueueRepo.markRetry).not.toHaveBeenCalled()
  })

  it('5/8: isRunning lock — 동시 실행 차단 (concurrent 진입 시 두 번째 호출 즉시 return)', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    const firstCallPromise = new Promise((resolve) => {
      resolveFirst = resolve
    })

    mockRetryQueueRepo.findDue.mockImplementationOnce(() => firstCallPromise)

    // 첫 호출 시작 (대기 상태 유지)
    const first = job.retryDueWebhooks()
    // 두 번째 호출 즉시 — isRunning=true이므로 skip
    await job.retryDueWebhooks()

    // findDue는 첫 호출에서만 1회 (두 번째는 lock으로 skip)
    expect(mockRetryQueueRepo.findDue).toHaveBeenCalledTimes(1)

    // 첫 호출 종료
    resolveFirst([])
    await first
  })

  it('6/8: 다중 row 순차 처리 (3건) — findDue → 각 row processNormalizedWebhook 호출', async () => {
    const records = [
      sampleRecord({ id: 'q-1', eventId: 'evt-1', payload: { ...sampleEvent, eventId: 'evt-1' } }),
      sampleRecord({ id: 'q-2', eventId: 'evt-2', payload: { ...sampleEvent, eventId: 'evt-2' } }),
      sampleRecord({ id: 'q-3', eventId: 'evt-3', payload: { ...sampleEvent, eventId: 'evt-3' } }),
    ]
    mockRetryQueueRepo.findDue.mockResolvedValueOnce(records)
    mockPaymentUseCase.processNormalizedWebhook.mockResolvedValue({
      processed: true,
      credits: 50,
    })

    await job.retryDueWebhooks()

    expect(mockPaymentUseCase.processNormalizedWebhook).toHaveBeenCalledTimes(3)
    expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledTimes(3)
    // 순차 호출 검증 — 각 eventId 박제
    expect(mockPaymentUseCase.processNormalizedWebhook.mock.calls.map((c) => c[0].eventId)).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
    ])
  })

  it('7/8: WEBHOOK_RETRY_DISABLED=1 env 시 즉시 return (findDue 호출 0회)', async () => {
    process.env.WEBHOOK_RETRY_DISABLED = '1'

    await job.retryDueWebhooks()

    expect(mockRetryQueueRepo.findDue).not.toHaveBeenCalled()
    expect(mockPaymentUseCase.processNormalizedWebhook).not.toHaveBeenCalled()
  })

  it('8/8: 백오프 스케줄 매트릭스 — retryCount 1m/5m/30m/2h/12h/24h 정합', async () => {
    // 5 cases — 1 → 1m, 2 → 5m, 3 → 30m, 4 → 2h, 5 → 12h, 6+ → 24h
    const cases: Array<{ initial: number; expectedMinutes: number }> = [
      { initial: 0, expectedMinutes: 1 }, // newCount=1 → 1m
      { initial: 1, expectedMinutes: 5 }, // newCount=2 → 5m
      { initial: 2, expectedMinutes: 30 }, // newCount=3 → 30m
      { initial: 3, expectedMinutes: 120 }, // newCount=4 → 2h
      { initial: 4, expectedMinutes: 720 }, // newCount=5 → 12h
      { initial: 5, expectedMinutes: 1440 }, // newCount=6 → 24h
    ]

    for (const { initial, expectedMinutes } of cases) {
      mockRetryQueueRepo.markRetry.mockClear()
      mockRetryQueueRepo.findDue.mockResolvedValueOnce([sampleRecord({ retryCount: initial })])
      mockPaymentUseCase.processNormalizedWebhook.mockRejectedValueOnce(new Error('failed'))

      const before = Date.now()
      await job.retryDueWebhooks()

      const callArgs = mockRetryQueueRepo.markRetry.mock.calls[0]
      const nextRetryAt = callArgs[2] as Date
      const minutesAhead = Math.round((nextRetryAt.getTime() - before) / 60_000)
      expect(minutesAhead).toBeGreaterThanOrEqual(expectedMinutes - 1)
      expect(minutesAhead).toBeLessThanOrEqual(expectedMinutes + 1)
    }
  })

  /**
   * Sprint PAY-P3-C — Retry 중복 해소 (모순-D 차단). 사전 dedup 게이트 6 it.
   * 정본: shared-contracts §23 RetryDeduplication.
   *
   * AC BDD 매핑:
   * - PAY-P3-C 1/6 → AC-1 (정상 retry pending 회귀 0)
   * - PAY-P3-C 2/6 → AC-2 (completed dedup)
   * - PAY-P3-C 3/6 → AC-3 (refunded dedup)
   * - PAY-P3-C 4/6 → AC-4 (partial_refunded dedup)
   * - PAY-P3-C 5/6 → AC-6 (MAX_RETRY 누적 차단 — 거짓 permanent_failed 박제 0건)
   * - PAY-P3-C 6/6 → AC-7 (mixed batch — pending + completed 동시 처리)
   */
  describe('PAY-P3-C — 사전 dedup 게이트 (모순-D 차단)', () => {
    it('PAY-P3-C 1/6: AC-1 — payment.status=pending 정상 retry 회귀 0 (processNormalizedWebhook 호출 정합)', async () => {
      const record = sampleRecord({ id: 'q-1', eventId: 'evt-1' })
      mockRetryQueueRepo.findDue.mockResolvedValueOnce([record])
      mockPaymentRepo.findByExternalTransactionId.mockResolvedValueOnce(samplePayment('pending'))
      mockPaymentUseCase.processNormalizedWebhook.mockResolvedValueOnce({
        processed: true,
        credits: 50,
      })

      await job.retryDueWebhooks()

      // 사전 dedup 게이트 진입 (paymentRepo 조회) — 통과 안 됨 (status=pending)
      expect(mockPaymentRepo.findByExternalTransactionId).toHaveBeenCalledWith('tr-1')
      // 기존 흐름 정합 — processNormalizedWebhook 호출 + deleteById
      expect(mockPaymentUseCase.processNormalizedWebhook).toHaveBeenCalledWith(sampleEvent)
      expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledWith('q-1')
      // dedup AuditLog 박제 0건
      expect(mockAuditLog.log).not.toHaveBeenCalledWith(
        'system_dlq',
        'retry_skip_dedup',
        expect.anything(),
        expect.anything(),
      )
    })

    it('PAY-P3-C 2/6: AC-2 — payment.status=completed dedup → processNormalizedWebhook 호출 0건 + AuditLog retry_skip_dedup', async () => {
      const record = sampleRecord({ id: 'q-2', eventId: 'evt-2', retryCount: 2 })
      mockRetryQueueRepo.findDue.mockResolvedValueOnce([record])
      mockPaymentRepo.findByExternalTransactionId.mockResolvedValueOnce(
        samplePayment('completed', { id: 'pay-completed' }),
      )

      await job.retryDueWebhooks()

      // 사전 dedup 발동 — processNormalizedWebhook 호출 0건
      expect(mockPaymentUseCase.processNormalizedWebhook).not.toHaveBeenCalled()
      // queue row 즉시 삭제
      expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledWith('q-2')
      expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledTimes(1)
      // markRetry 호출 0건
      expect(mockRetryQueueRepo.markRetry).not.toHaveBeenCalled()
      // AuditLog operator='system_dlq' action='retry_skip_dedup' meta 박제
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'system_dlq',
        'retry_skip_dedup',
        'evt-2',
        expect.objectContaining({
          reason: 'payment_already_finalized',
          paymentStatus: 'completed',
          retryCount: 2,
          paymentId: 'pay-completed',
        }),
      )
    })

    it('PAY-P3-C 3/6: AC-3 — payment.status=refunded dedup', async () => {
      const record = sampleRecord({ id: 'q-3', eventId: 'evt-3', retryCount: 3 })
      mockRetryQueueRepo.findDue.mockResolvedValueOnce([record])
      mockPaymentRepo.findByExternalTransactionId.mockResolvedValueOnce(
        samplePayment('refunded', { id: 'pay-refunded' }),
      )

      await job.retryDueWebhooks()

      expect(mockPaymentUseCase.processNormalizedWebhook).not.toHaveBeenCalled()
      expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledWith('q-3')
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'system_dlq',
        'retry_skip_dedup',
        'evt-3',
        expect.objectContaining({
          paymentStatus: 'refunded',
          retryCount: 3,
          paymentId: 'pay-refunded',
        }),
      )
    })

    it('PAY-P3-C 4/6: AC-4 — payment.status=partial_refunded dedup', async () => {
      const record = sampleRecord({ id: 'q-4', eventId: 'evt-4', retryCount: 5 })
      mockRetryQueueRepo.findDue.mockResolvedValueOnce([record])
      mockPaymentRepo.findByExternalTransactionId.mockResolvedValueOnce(
        samplePayment('partial_refunded', { id: 'pay-partial' }),
      )

      await job.retryDueWebhooks()

      expect(mockPaymentUseCase.processNormalizedWebhook).not.toHaveBeenCalled()
      expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledWith('q-4')
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'system_dlq',
        'retry_skip_dedup',
        'evt-4',
        expect.objectContaining({
          paymentStatus: 'partial_refunded',
          retryCount: 5,
          paymentId: 'pay-partial',
        }),
      )
    })

    it('PAY-P3-C 5/6: AC-6 — retryCount=9 (MAX_RETRY-1) + payment.status=completed 시 거짓 permanent_failed 박제 0건', async () => {
      // 본 sprint 핵심 보안 영역: 이미 boost된 payment의 retry queue row가 MAX_RETRY까지 누적되어
      // permanent_failed 박제되는 케이스 차단
      const record = sampleRecord({ id: 'q-5', eventId: 'evt-loop', retryCount: 9 })
      mockRetryQueueRepo.findDue.mockResolvedValueOnce([record])
      mockPaymentRepo.findByExternalTransactionId.mockResolvedValueOnce(
        samplePayment('completed', { id: 'pay-loop' }),
      )

      await job.retryDueWebhooks()

      // dedup 차단 — processNormalizedWebhook 호출 0건 (markRetry 0, markPermanentFailed 0)
      expect(mockPaymentUseCase.processNormalizedWebhook).not.toHaveBeenCalled()
      expect(mockRetryQueueRepo.markRetry).not.toHaveBeenCalled()
      // webhook_events markStatus 호출 0건 (permanent_failed 박제 0건)
      expect(mockWebhookEventRepo.markStatus).not.toHaveBeenCalled()
      // AuditLog action='webhook_permanent_failed' 박제 0건 (거짓 permanent_failed 차단)
      expect(mockAuditLog.log).not.toHaveBeenCalledWith(
        'system_dlq',
        'webhook_permanent_failed',
        expect.anything(),
        expect.anything(),
      )
      // AuditLog action='retry_skip_dedup' 박제 1건
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'system_dlq',
        'retry_skip_dedup',
        'evt-loop',
        expect.objectContaining({
          paymentStatus: 'completed',
          retryCount: 9,
        }),
      )
      // queue row deleteById 즉시 호출
      expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledWith('q-5')
    })

    it('PAY-P3-C 6/6: AC-7 — mixed batch (pending + completed) → 정상 + dedup 동시 처리', async () => {
      const records = [
        sampleRecord({ id: 'q-mix-1', eventId: 'evt-mix-1', payload: { ...sampleEvent, eventId: 'evt-mix-1', tradeNo: 'tr-pending' } }),
        sampleRecord({ id: 'q-mix-2', eventId: 'evt-mix-2', payload: { ...sampleEvent, eventId: 'evt-mix-2', tradeNo: 'tr-done' } }),
      ]
      mockRetryQueueRepo.findDue.mockResolvedValueOnce(records)
      // 첫 호출 (tr-pending) → pending, 두 번째 (tr-done) → completed
      mockPaymentRepo.findByExternalTransactionId
        .mockResolvedValueOnce(samplePayment('pending', { id: 'pay-mix-pending' }))
        .mockResolvedValueOnce(samplePayment('completed', { id: 'pay-mix-done' }))
      mockPaymentUseCase.processNormalizedWebhook.mockResolvedValueOnce({
        processed: true,
        credits: 50,
      })

      await job.retryDueWebhooks()

      // 1건 pending → processNormalizedWebhook 호출 정합
      expect(mockPaymentUseCase.processNormalizedWebhook).toHaveBeenCalledTimes(1)
      expect(mockPaymentUseCase.processNormalizedWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-mix-1' }),
      )
      // 1건 completed → dedup AuditLog 박제
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'system_dlq',
        'retry_skip_dedup',
        'evt-mix-2',
        expect.objectContaining({ paymentStatus: 'completed' }),
      )
      // 두 건 모두 deleteById (정상 1 + dedup 1)
      expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledTimes(2)
      expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledWith('q-mix-1')
      expect(mockRetryQueueRepo.deleteById).toHaveBeenCalledWith('q-mix-2')
      // markRetry / markPermanentFailed 0건
      expect(mockRetryQueueRepo.markRetry).not.toHaveBeenCalled()
      expect(mockWebhookEventRepo.markStatus).not.toHaveBeenCalled()
    })
  })
})
