import { InMemoryCircuitBreakerAdapter } from './in-memory-circuit-breaker.adapter'
import {
  CircuitBreakerState,
  CircuitOpenError,
} from '@domain/model/circuit-breaker-state'

/**
 * InMemoryCircuitBreakerAdapter spec — PAY-P3-H (2026-05-15)
 *
 * 3 상태 머신 매트릭스 검증:
 * - CLOSED 정상 흐름 + failureCount 누적 + 임계값 초과 OPEN 전환
 * - OPEN fail-fast (SDK 호출 0건) + cooldown 경과 HALF_OPEN 전환
 * - HALF_OPEN trial 누적 + 성공 CLOSED 복귀 + 실패 OPEN 복귀
 * - reset window 자연 리셋 (CLOSED 영역)
 * - 호출점 분리 (호출점별 독립 상태)
 * - 강제 forceOpen / forceClose
 * - AuditLog 4 action 박제
 *
 * 사용자 5/15 결정 (옵션 B Hystrix 정합):
 * - failureThreshold=5, cooldownMs=30000, halfOpenTrial=3, resetWindowMs=60000
 *
 * 정본: `.claude/shared-contracts.md §27 CircuitBreakerPolicy`, ADR-009.
 */
describe('InMemoryCircuitBreakerAdapter — PAY-P3-H', () => {
  let breaker: InMemoryCircuitBreakerAdapter
  let mockAuditLog: { log: jest.Mock }

  beforeEach(() => {
    // env 정합 강제 — 옵션 B 권장값 (사용자 5/15)
    process.env.POLAR_CB_FAILURE_THRESHOLD = '5'
    process.env.POLAR_CB_COOLDOWN_MS = '30000'
    process.env.POLAR_CB_HALF_OPEN_TRIAL = '3'
    process.env.POLAR_CB_RESET_WINDOW_MS = '60000'

    mockAuditLog = { log: jest.fn().mockResolvedValue(undefined) }
    breaker = new InMemoryCircuitBreakerAdapter(mockAuditLog as never)
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    delete process.env.POLAR_CB_FAILURE_THRESHOLD
    delete process.env.POLAR_CB_COOLDOWN_MS
    delete process.env.POLAR_CB_HALF_OPEN_TRIAL
    delete process.env.POLAR_CB_RESET_WINDOW_MS
  })

  describe('CLOSED 정상 흐름', () => {
    it('CLOSED 상태 — 호출 성공 시 failureCount 0 유지', async () => {
      const result = await breaker.execute('polar:checkouts:create', async () => 'ok')

      expect(result).toBe('ok')
      const stats = breaker.getStats('polar:checkouts:create')
      expect(stats.state).toBe(CircuitBreakerState.CLOSED)
      expect(stats.failureCount).toBe(0)
      expect(stats.lastSuccessAt).toBeInstanceOf(Date)
    })

    it('CLOSED 상태 — 호출 실패 시 failureCount++ 누적 + 임계값 미달 시 CLOSED 유지', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('SDK fail'))

      for (let i = 0; i < 4; i++) {
        await expect(breaker.execute('polar:checkouts:create', fn)).rejects.toThrow('SDK fail')
      }

      const stats = breaker.getStats('polar:checkouts:create')
      expect(stats.state).toBe(CircuitBreakerState.CLOSED)
      expect(stats.failureCount).toBe(4)
      expect(fn).toHaveBeenCalledTimes(4)
    })
  })

  describe('CLOSED → OPEN 전환', () => {
    it('CLOSED → OPEN — 실패 임계값 (5회) 초과 시 OPEN 전환', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('SDK fail'))

      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', fn)).rejects.toThrow('SDK fail')
      }

      const stats = breaker.getStats('polar:checkouts:create')
      expect(stats.state).toBe(CircuitBreakerState.OPEN)
      expect(stats.failureCount).toBe(5)
      expect(stats.openedAt).toBeInstanceOf(Date)
    })

    it('CLOSED → OPEN — AuditLog circuit_breaker.open 박제 (failure_threshold_exceeded)', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('SDK fail timeout'))

      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', fn)).rejects.toThrow()
      }

      // AuditLog 박제 매트릭스 — 5회째 실패 시 open 박제
      const openCall = mockAuditLog.log.mock.calls.find(
        (c: unknown[]) => c[1] === 'circuit_breaker.open',
      )
      expect(openCall).toBeDefined()
      expect(openCall![0]).toBe('system_circuit_breaker')
      expect(openCall![2]).toBe('polar:checkouts:create')
      expect(openCall![3]).toMatchObject({
        reason: 'failure_threshold_exceeded',
        circuitKey: 'polar:checkouts:create',
        failureCount: 5,
        failureThreshold: 5,
      })
    })
  })

  describe('OPEN fail-fast (SDK 호출 0건)', () => {
    it('OPEN 상태 — 호출 요청 시 즉시 CircuitOpenError throw (fn 호출 0건)', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('SDK fail'))
      // CLOSED → OPEN 강제 진입 (5회 실패)
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', failingFn)).rejects.toThrow()
      }
      expect(breaker.getState('polar:checkouts:create')).toBe(CircuitBreakerState.OPEN)

      // OPEN 상태에서 fn 호출 시도 — CircuitOpenError throw, fn() 실행 0건
      const newFn = jest.fn().mockResolvedValue('would-be-ok')
      await expect(
        breaker.execute('polar:checkouts:create', newFn),
      ).rejects.toThrow(CircuitOpenError)
      expect(newFn).not.toHaveBeenCalled()
    })

    it('OPEN 상태 — 호출 차단 시 AuditLog circuit_breaker.reject 박제', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('SDK fail'))
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', failingFn)).rejects.toThrow()
      }
      // 박제 카운터 리셋
      mockAuditLog.log.mockClear()

      const blockedFn = jest.fn()
      await expect(
        breaker.execute('polar:checkouts:create', blockedFn),
      ).rejects.toThrow(CircuitOpenError)

      // AuditLog reject 박제 — reason='circuit_open'
      const rejectCall = mockAuditLog.log.mock.calls.find(
        (c: unknown[]) => c[1] === 'circuit_breaker.reject',
      )
      expect(rejectCall).toBeDefined()
      expect(rejectCall![3]).toMatchObject({
        reason: 'circuit_open',
        circuitKey: 'polar:checkouts:create',
      })
    })
  })

  describe('OPEN → HALF_OPEN 자동 전환 (cooldown 경과)', () => {
    it('OPEN → HALF_OPEN — cooldown (30s) 경과 후 호출 요청 시 HALF_OPEN 전환', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('SDK fail'))
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', failingFn)).rejects.toThrow()
      }
      expect(breaker.getState('polar:checkouts:create')).toBe(CircuitBreakerState.OPEN)

      // cooldown 30s 경과 시뮬 (Date.now 31s 진행)
      jest.setSystemTime(new Date(Date.now() + 31_000))

      // HALF_OPEN trial 진입 — 호출 성공 시 1 trial 카운트
      const successFn = jest.fn().mockResolvedValue('trial-1')
      const result = await breaker.execute('polar:checkouts:create', successFn)

      expect(result).toBe('trial-1')
      expect(successFn).toHaveBeenCalledTimes(1)
      // halfOpenTrial=3이므로 1회 성공으로는 아직 HALF_OPEN 유지
      expect(breaker.getState('polar:checkouts:create')).toBe(CircuitBreakerState.HALF_OPEN)
    })

    it('OPEN → HALF_OPEN — AuditLog circuit_breaker.half_open_trial 박제', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('SDK fail'))
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', failingFn)).rejects.toThrow()
      }
      mockAuditLog.log.mockClear()

      jest.setSystemTime(new Date(Date.now() + 31_000))
      await breaker.execute('polar:checkouts:create', async () => 'ok')

      const halfOpenCall = mockAuditLog.log.mock.calls.find(
        (c: unknown[]) => c[1] === 'circuit_breaker.half_open_trial',
      )
      expect(halfOpenCall).toBeDefined()
      expect(halfOpenCall![3]).toMatchObject({
        reason: 'cooldown_elapsed',
        circuitKey: 'polar:checkouts:create',
        cooldownMs: 30000,
        halfOpenTrialMax: 3,
      })
    })
  })

  describe('HALF_OPEN → CLOSED 복귀 (trial 모두 성공)', () => {
    it('HALF_OPEN → CLOSED — trial 3회 모두 성공 시 CLOSED 복귀 + failureCount=0', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('SDK fail'))
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', failingFn)).rejects.toThrow()
      }
      jest.setSystemTime(new Date(Date.now() + 31_000))

      // trial 3회 모두 성공
      const successFn = jest.fn().mockResolvedValue('ok')
      await breaker.execute('polar:checkouts:create', successFn)
      await breaker.execute('polar:checkouts:create', successFn)
      await breaker.execute('polar:checkouts:create', successFn)

      const stats = breaker.getStats('polar:checkouts:create')
      expect(stats.state).toBe(CircuitBreakerState.CLOSED)
      expect(stats.failureCount).toBe(0)
      expect(stats.openedAt).toBeUndefined()
      expect(successFn).toHaveBeenCalledTimes(3)
    })

    it('HALF_OPEN → CLOSED — AuditLog circuit_breaker.close 박제 (half_open_trial_succeeded)', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('SDK fail'))
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', failingFn)).rejects.toThrow()
      }
      jest.setSystemTime(new Date(Date.now() + 31_000))
      mockAuditLog.log.mockClear()

      for (let i = 0; i < 3; i++) {
        await breaker.execute('polar:checkouts:create', async () => 'ok')
      }

      const closeCall = mockAuditLog.log.mock.calls.find(
        (c: unknown[]) => c[1] === 'circuit_breaker.close',
      )
      expect(closeCall).toBeDefined()
      expect(closeCall![3]).toMatchObject({
        reason: 'half_open_trial_succeeded',
        circuitKey: 'polar:checkouts:create',
        halfOpenTrialMax: 3,
      })
    })
  })

  describe('HALF_OPEN → OPEN 복귀 (trial 실패)', () => {
    it('HALF_OPEN → OPEN — trial 1회 실패 시 즉시 OPEN 복귀 (cooldown 재시작)', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('SDK fail'))
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', failingFn)).rejects.toThrow()
      }
      const originalOpenedAt = breaker.getStats('polar:checkouts:create').openedAt!
      jest.setSystemTime(new Date(Date.now() + 31_000))

      // HALF_OPEN 진입 + trial 실패
      await expect(
        breaker.execute('polar:checkouts:create', failingFn),
      ).rejects.toThrow('SDK fail')

      const stats = breaker.getStats('polar:checkouts:create')
      expect(stats.state).toBe(CircuitBreakerState.OPEN)
      // cooldown 재시작 — openedAt 갱신
      expect(stats.openedAt!.getTime()).toBeGreaterThan(originalOpenedAt.getTime())
    })
  })

  describe('호출점 분리 (호출점별 독립 상태)', () => {
    it('호출점 분리 — polar:checkouts:create OPEN 시 polar:checkouts:list 영향 0', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('SDK fail'))
      // polar:checkouts:create만 5회 실패 (OPEN 진입)
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', failingFn)).rejects.toThrow()
      }
      expect(breaker.getState('polar:checkouts:create')).toBe(CircuitBreakerState.OPEN)

      // polar:checkouts:list — 영향 0, 정상 호출 가능
      const successFn = jest.fn().mockResolvedValue('list-ok')
      const result = await breaker.execute('polar:checkouts:list', successFn)
      expect(result).toBe('list-ok')
      expect(breaker.getState('polar:checkouts:list')).toBe(CircuitBreakerState.CLOSED)
    })

    it('3 호출점 분리 — polar:checkouts:get도 독립 상태 보존', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('SDK fail'))
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:list', failingFn)).rejects.toThrow()
      }
      // get 영역 — 영향 0
      expect(breaker.getState('polar:checkouts:get')).toBe(CircuitBreakerState.CLOSED)

      const successFn = jest.fn().mockResolvedValue('get-ok')
      await breaker.execute('polar:checkouts:get', successFn)
      expect(breaker.getState('polar:checkouts:get')).toBe(CircuitBreakerState.CLOSED)
    })
  })

  describe('reset window 자연 리셋 (CLOSED 영역)', () => {
    it('reset window — failureCount > 0 + reset window (60s) 경과 시 자연 리셋 (CLOSED 유지)', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('SDK fail'))
      // 3회 실패 (임계값 5 미달, CLOSED 유지)
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute('polar:checkouts:create', failingFn)).rejects.toThrow()
      }
      expect(breaker.getStats('polar:checkouts:create').failureCount).toBe(3)

      // reset window 60s 경과
      jest.setSystemTime(new Date(Date.now() + 61_000))

      // 다음 호출 시 failureCount 자연 리셋
      await breaker.execute('polar:checkouts:create', async () => 'ok')
      const stats = breaker.getStats('polar:checkouts:create')
      expect(stats.state).toBe(CircuitBreakerState.CLOSED)
      expect(stats.failureCount).toBe(0)
    })
  })

  describe('forceOpen / forceClose (운영자 수동 영역)', () => {
    it('forceOpen — 상태 강제 OPEN + AuditLog circuit_breaker.open 박제 (manual_force_open)', async () => {
      await breaker.forceOpen('polar:checkouts:create', 'maintenance window')

      expect(breaker.getState('polar:checkouts:create')).toBe(CircuitBreakerState.OPEN)
      const openCall = mockAuditLog.log.mock.calls.find(
        (c: unknown[]) => c[1] === 'circuit_breaker.open',
      )
      expect(openCall![3]).toMatchObject({
        reason: expect.stringContaining('manual_force_open'),
        circuitKey: 'polar:checkouts:create',
      })
    })

    it('forceClose — 상태 강제 CLOSED + failureCount=0 + AuditLog circuit_breaker.close 박제', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('SDK fail'))
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', failingFn)).rejects.toThrow()
      }
      mockAuditLog.log.mockClear()

      await breaker.forceClose('polar:checkouts:create', 'manual recovery')

      const stats = breaker.getStats('polar:checkouts:create')
      expect(stats.state).toBe(CircuitBreakerState.CLOSED)
      expect(stats.failureCount).toBe(0)
      const closeCall = mockAuditLog.log.mock.calls.find(
        (c: unknown[]) => c[1] === 'circuit_breaker.close',
      )
      expect(closeCall![3]).toMatchObject({
        reason: expect.stringContaining('manual_force_close'),
      })
    })
  })

  describe('AuditLog 회복력 (Optional + 박제 실패 비차단)', () => {
    it('AuditLog 미주입 — 박제 0건 정합 (회귀 보존, 메인 흐름 동작)', async () => {
      const breakerNoAudit = new InMemoryCircuitBreakerAdapter()
      const fn = jest.fn().mockRejectedValue(new Error('SDK fail'))

      for (let i = 0; i < 5; i++) {
        await expect(breakerNoAudit.execute('key', fn)).rejects.toThrow()
      }
      // AuditLog 미주입에도 정상 OPEN 전환
      expect(breakerNoAudit.getState('key')).toBe(CircuitBreakerState.OPEN)
    })

    it('AuditLog 박제 실패 — 메인 흐름 비차단 (logger.warn만)', async () => {
      mockAuditLog.log.mockRejectedValue(new Error('AuditLog DB down'))
      const fn = jest.fn().mockRejectedValue(new Error('SDK fail'))

      // 박제 실패에도 OPEN 전환 정상 진행
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute('polar:checkouts:create', fn)).rejects.toThrow('SDK fail')
      }
      expect(breaker.getState('polar:checkouts:create')).toBe(CircuitBreakerState.OPEN)
    })
  })
})
