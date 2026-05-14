import { Injectable, Logger, Optional, Inject } from '@nestjs/common'
import { CircuitBreakerPort } from '@domain/port/outbound/circuit-breaker.port'
import {
  CircuitBreakerPolicy,
  CircuitBreakerState,
  CircuitBreakerStats,
  CircuitOpenError,
} from '@domain/model/circuit-breaker-state'
import { AuditLogService } from '@application/admin/audit-log.service'

/**
 * In-memory Circuit Breaker adapter — PAY-P3-H (2026-05-15)
 *
 * Hystrix 3 상태 머신 정합 (CLOSED / OPEN / HALF_OPEN) — Polar SDK 호출 경계 가용성 차단.
 * 정본: `.claude/shared-contracts.md §27 CircuitBreakerPolicy`, ADR-009.
 *
 * 단일 인스턴스 가정 — 다중 인스턴스 시점 Redis 분산 상태 별도 sprint 영역.
 * 본 sprint = `Map<string, CircuitBreakerStats>` 기반 호출점별 상태 분리.
 *
 * 정책 env 4건 (사용자 5/15 결정 옵션 B Hystrix 정합):
 * - POLAR_CB_FAILURE_THRESHOLD (기본 5)
 * - POLAR_CB_COOLDOWN_MS (기본 30000)
 * - POLAR_CB_HALF_OPEN_TRIAL (기본 3)
 * - POLAR_CB_RESET_WINDOW_MS (기본 60000)
 *
 * AuditLog 4 action 박제:
 * - `circuit_breaker.open` (CLOSED→OPEN 또는 HALF_OPEN→OPEN)
 * - `circuit_breaker.close` (HALF_OPEN→CLOSED)
 * - `circuit_breaker.half_open_trial` (OPEN→HALF_OPEN, cooldown 경과)
 * - `circuit_breaker.reject` (OPEN 상태 호출 차단)
 *
 * AuditLog Optional — 미주입 시 logger.warn 박제만 (회귀 보존).
 */
@Injectable()
export class InMemoryCircuitBreakerAdapter implements CircuitBreakerPort {
  private readonly logger = new Logger(InMemoryCircuitBreakerAdapter.name)
  private readonly stats = new Map<string, CircuitBreakerStats>()
  private readonly policy: CircuitBreakerPolicy

  constructor(
    @Optional() @Inject(AuditLogService) private readonly auditLog?: AuditLogService,
  ) {
    this.policy = {
      failureThreshold: this.parseEnvInt(process.env.POLAR_CB_FAILURE_THRESHOLD, 5),
      cooldownMs: this.parseEnvInt(process.env.POLAR_CB_COOLDOWN_MS, 30_000),
      halfOpenTrial: this.parseEnvInt(process.env.POLAR_CB_HALF_OPEN_TRIAL, 3),
      resetWindowMs: this.parseEnvInt(process.env.POLAR_CB_RESET_WINDOW_MS, 60_000),
    }
    this.logger.log(
      `[CircuitBreaker] policy 박제 — failureThreshold=${this.policy.failureThreshold} cooldownMs=${this.policy.cooldownMs} halfOpenTrial=${this.policy.halfOpenTrial} resetWindowMs=${this.policy.resetWindowMs}`,
    )
  }

  /**
   * env 정수 파싱 (NaN/음수 fallback 처리).
   * 본 sprint 정합 — 부정확한 정책 값으로 인한 false-positive OPEN 차단.
   */
  private parseEnvInt(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback
    const parsed = parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  /**
   * 초기 stats (lazy init 정합) — state=CLOSED, failureCount=0.
   */
  private initStats(): CircuitBreakerStats {
    return {
      state: CircuitBreakerState.CLOSED,
      failureCount: 0,
      halfOpenTrialCount: 0,
      halfOpenSuccessCount: 0,
    }
  }

  /**
   * 호출점 stats 조회 — 미진입 시 lazy 초기 stats 반환 + Map 박제.
   */
  private getOrInit(key: string): CircuitBreakerStats {
    let s = this.stats.get(key)
    if (!s) {
      s = this.initStats()
      this.stats.set(key, s)
    }
    return s
  }

  /**
   * reset window 자연 리셋 (CLOSED 상태에서 lastFailureAt 경과 시 failureCount = 0).
   * 본 메서드는 execute 진입 시점 의무 호출 — 정책 정합 강제.
   */
  private maybeResetFailureCount(s: CircuitBreakerStats, now: Date): void {
    if (s.state !== CircuitBreakerState.CLOSED) return
    if (s.failureCount === 0) return
    if (!s.lastFailureAt) return
    const elapsed = now.getTime() - s.lastFailureAt.getTime()
    if (elapsed >= this.policy.resetWindowMs) {
      s.failureCount = 0
    }
  }

  /**
   * OPEN → HALF_OPEN 자동 전환 (cooldown 경과 + 호출 요청 시점).
   * AuditLog `circuit_breaker.half_open_trial` 박제.
   */
  private async maybePromoteToHalfOpen(
    key: string,
    s: CircuitBreakerStats,
    now: Date,
  ): Promise<void> {
    if (s.state !== CircuitBreakerState.OPEN) return
    if (!s.openedAt) return
    const elapsed = now.getTime() - s.openedAt.getTime()
    if (elapsed < this.policy.cooldownMs) return

    // OPEN → HALF_OPEN 전환
    s.state = CircuitBreakerState.HALF_OPEN
    s.halfOpenAt = now
    s.halfOpenTrialCount = 0
    s.halfOpenSuccessCount = 0
    this.logger.warn(
      `[CircuitBreaker] OPEN→HALF_OPEN ${key} — cooldown ${this.policy.cooldownMs}ms 경과`,
    )
    await this.safeAuditLog(
      'circuit_breaker.half_open_trial',
      key,
      {
        reason: 'cooldown_elapsed',
        circuitKey: key,
        cooldownMs: this.policy.cooldownMs,
        halfOpenTrialMax: this.policy.halfOpenTrial,
      },
    )
  }

  /**
   * CircuitBreakerPort.execute — 호출 래핑 (3 상태 머신 정합).
   *
   * 흐름:
   * 1. lazy init stats
   * 2. reset window 자연 리셋 (CLOSED + lastFailureAt 경과)
   * 3. OPEN → HALF_OPEN 자동 전환 (cooldown 경과)
   * 4. 현재 상태별 분기:
   *    - OPEN: CircuitOpenError throw (AuditLog `circuit_breaker.reject` 박제)
   *    - HALF_OPEN: trial 초과 시 CircuitOpenError throw, 미달 시 trial 진입
   *    - CLOSED: 정상 흐름
   * 5. fn() 실행
   * 6. 성공/실패별 상태 전환
   */
  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = new Date()
    const s = this.getOrInit(key)

    this.maybeResetFailureCount(s, now)
    await this.maybePromoteToHalfOpen(key, s, now)

    // OPEN 상태 — 즉시 fail-fast (SDK 호출 0건 강제)
    if (s.state === CircuitBreakerState.OPEN) {
      await this.safeAuditLog(
        'circuit_breaker.reject',
        key,
        {
          reason: 'circuit_open',
          circuitKey: key,
          failureCount: s.failureCount,
          openedAt: s.openedAt?.toISOString(),
        },
      )
      throw new CircuitOpenError(key, { ...s })
    }

    // HALF_OPEN trial 초과 — 추가 호출 차단 (trial 동시성 방어)
    if (
      s.state === CircuitBreakerState.HALF_OPEN &&
      s.halfOpenTrialCount >= this.policy.halfOpenTrial
    ) {
      await this.safeAuditLog(
        'circuit_breaker.reject',
        key,
        {
          reason: 'half_open_trial_exhausted',
          circuitKey: key,
          halfOpenTrialCount: s.halfOpenTrialCount,
          halfOpenTrialMax: this.policy.halfOpenTrial,
        },
      )
      throw new CircuitOpenError(key, { ...s })
    }

    // HALF_OPEN trial 카운터 ++ (실제 호출 시도 박제 시점)
    if (s.state === CircuitBreakerState.HALF_OPEN) {
      s.halfOpenTrialCount += 1
    }

    // 실제 fn() 실행
    try {
      const result = await fn()
      await this.onSuccess(key, s, new Date())
      return result
    } catch (e: unknown) {
      await this.onFailure(key, s, new Date(), e)
      throw e
    }
  }

  /**
   * fn() 성공 분기 — 상태별 후속 처리.
   *
   * - CLOSED: failureCount 보존 (reset window 정합), lastSuccessAt 갱신
   * - HALF_OPEN: halfOpenSuccessCount++ → halfOpenTrial 도달 시 CLOSED 복귀 (AuditLog `circuit_breaker.close`)
   * - OPEN: 진입 0건 (execute에서 차단)
   */
  private async onSuccess(
    key: string,
    s: CircuitBreakerStats,
    now: Date,
  ): Promise<void> {
    s.lastSuccessAt = now

    if (s.state === CircuitBreakerState.HALF_OPEN) {
      s.halfOpenSuccessCount += 1
      // 모든 trial 성공 시 CLOSED 복귀
      if (s.halfOpenSuccessCount >= this.policy.halfOpenTrial) {
        const previousState = s.state
        s.state = CircuitBreakerState.CLOSED
        s.failureCount = 0
        s.openedAt = undefined
        s.halfOpenAt = undefined
        s.halfOpenTrialCount = 0
        s.halfOpenSuccessCount = 0
        this.logger.log(
          `[CircuitBreaker] HALF_OPEN→CLOSED ${key} — trial ${this.policy.halfOpenTrial}회 성공`,
        )
        await this.safeAuditLog(
          'circuit_breaker.close',
          key,
          {
            reason: 'half_open_trial_succeeded',
            circuitKey: key,
            halfOpenTrialMax: this.policy.halfOpenTrial,
            previousState,
          },
        )
      }
    }
  }

  /**
   * fn() 실패 분기 — 상태별 후속 처리.
   *
   * - CLOSED: failureCount++ → 임계값 초과 시 OPEN 전환 (AuditLog `circuit_breaker.open`)
   * - HALF_OPEN: 즉시 OPEN 복귀 (cooldown 재시작, AuditLog `circuit_breaker.open`)
   * - OPEN: 진입 0건 (execute에서 차단)
   *
   * CircuitOpenError는 본 메서드 진입 0건 정합 (execute가 throw 처리, 본 메서드는 fn() 실패만).
   */
  private async onFailure(
    key: string,
    s: CircuitBreakerStats,
    now: Date,
    error: unknown,
  ): Promise<void> {
    s.lastFailureAt = now

    if (s.state === CircuitBreakerState.HALF_OPEN) {
      // HALF_OPEN trial 실패 → 즉시 OPEN 복귀
      const previousState = s.state
      s.state = CircuitBreakerState.OPEN
      s.openedAt = now
      s.halfOpenAt = undefined
      s.halfOpenTrialCount = 0
      s.halfOpenSuccessCount = 0
      this.logger.error(
        `[CircuitBreaker] HALF_OPEN→OPEN ${key} — trial 실패, cooldown 재시작`,
      )
      await this.safeAuditLog(
        'circuit_breaker.open',
        key,
        {
          reason: 'half_open_trial_failed',
          circuitKey: key,
          failureCount: s.failureCount,
          previousState,
          errorMessage: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
        },
      )
      return
    }

    // CLOSED 상태 — failureCount++
    s.failureCount += 1
    if (s.failureCount >= this.policy.failureThreshold) {
      const previousState = s.state
      s.state = CircuitBreakerState.OPEN
      s.openedAt = now
      this.logger.error(
        `[CircuitBreaker] CLOSED→OPEN ${key} — 실패 임계값 ${this.policy.failureThreshold}회 초과`,
      )
      await this.safeAuditLog(
        'circuit_breaker.open',
        key,
        {
          reason: 'failure_threshold_exceeded',
          circuitKey: key,
          failureCount: s.failureCount,
          failureThreshold: this.policy.failureThreshold,
          previousState,
          errorMessage: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
        },
      )
    }
  }

  /**
   * CircuitBreakerPort.getState — 현재 상태 조회 (디버깅 + 테스트 영역).
   */
  getState(key: string): CircuitBreakerState {
    return this.stats.get(key)?.state ?? CircuitBreakerState.CLOSED
  }

  /**
   * CircuitBreakerPort.getStats — 현재 통계 조회.
   * 미진입 key 조회 시 초기 stats 반환 (lazy init 정합, Map 박제 0건).
   */
  getStats(key: string): CircuitBreakerStats {
    const s = this.stats.get(key)
    if (!s) {
      return this.initStats()
    }
    return { ...s }
  }

  /**
   * CircuitBreakerPort.forceOpen — 운영자 수동 차단.
   * AuditLog `circuit_breaker.open` 박제 (reason='manual_force_open').
   */
  async forceOpen(key: string, reason: string): Promise<void> {
    const now = new Date()
    const s = this.getOrInit(key)
    const previousState = s.state
    s.state = CircuitBreakerState.OPEN
    s.openedAt = now
    s.halfOpenAt = undefined
    s.halfOpenTrialCount = 0
    s.halfOpenSuccessCount = 0
    this.logger.warn(`[CircuitBreaker] forceOpen ${key} — reason="${reason}"`)
    await this.safeAuditLog(
      'circuit_breaker.open',
      key,
      {
        reason: `manual_force_open: ${reason}`,
        circuitKey: key,
        previousState,
      },
    )
  }

  /**
   * CircuitBreakerPort.forceClose — 운영자 수동 복구.
   * AuditLog `circuit_breaker.close` 박제 (reason='manual_force_close').
   */
  async forceClose(key: string, reason: string): Promise<void> {
    const s = this.getOrInit(key)
    const previousState = s.state
    s.state = CircuitBreakerState.CLOSED
    s.failureCount = 0
    s.openedAt = undefined
    s.halfOpenAt = undefined
    s.halfOpenTrialCount = 0
    s.halfOpenSuccessCount = 0
    this.logger.warn(`[CircuitBreaker] forceClose ${key} — reason="${reason}"`)
    await this.safeAuditLog(
      'circuit_breaker.close',
      key,
      {
        reason: `manual_force_close: ${reason}`,
        circuitKey: key,
        previousState,
      },
    )
  }

  /**
   * AuditLog 박제 — 예외 발생 시 logger.warn만 (회귀 보존, 메인 흐름 비차단).
   * AuditLog 미주입 시 (Optional) 박제 0건 정합.
   */
  private async safeAuditLog(
    action: string,
    targetKey: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditLog) return
    try {
      await this.auditLog.log('system_circuit_breaker', action, targetKey, detail)
    } catch (e: unknown) {
      this.logger.warn(
        `AuditLog 박제 실패 (action=${action}, key=${targetKey}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
  }
}
