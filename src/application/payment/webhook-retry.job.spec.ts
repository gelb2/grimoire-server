import { WebhookRetryJob } from './webhook-retry.job'
import type { WebhookRetryQueueRecord } from '@domain/port/outbound/webhook-retry-queue-repository.port'

/**
 * Sprint PAY-P2-2 WebhookRetryJob spec — 8 it 박제 (정본: shared-contracts §18 + reports/PAY-P2-MASTER-PLAN.md §4).
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
})
