/**
 * Circuit Breaker 도메인 모델 — PAY-P3-H (2026-05-15)
 *
 * Polar SDK 호출 경계 가용성 차단 (Hystrix 3 상태 머신 정합).
 * 정본: `.claude/shared-contracts.md §27 CircuitBreakerPolicy`
 *
 * 본 파일 = 순수 도메인 (NestJS / Prisma import 0건 강제).
 * 의존성 0건 — 단순 enum + interface + Error 도메인.
 */

/**
 * Circuit Breaker 3 상태 머신.
 *
 * - CLOSED: 정상 흐름. 모든 호출 통과. 실패 카운터 누적만 (reset window 후 자동 리셋).
 * - OPEN: 차단 상태. 모든 호출 즉시 fail-fast (실제 SDK 호출 0건). cooldown 경과 후 자동 HALF-OPEN 전환.
 * - HALF_OPEN: 회복 시도. trial 횟수만큼 호출 허용. 성공 → CLOSED 복귀. 실패 → OPEN 복귀 (cooldown 재시작).
 */
export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

/**
 * Circuit Breaker 정책 설정.
 * env 4건으로 override 가능 (POLAR_CB_FAILURE_THRESHOLD / POLAR_CB_COOLDOWN_MS / POLAR_CB_HALF_OPEN_TRIAL / POLAR_CB_RESET_WINDOW_MS).
 *
 * 사용자 5/15 결정 (Draft §16 권장값 = 옵션 B Hystrix 정합):
 * - failureThreshold: 5
 * - cooldownMs: 30_000 (30초)
 * - halfOpenTrial: 3
 * - resetWindowMs: 60_000 (1분)
 */
export interface CircuitBreakerPolicy {
  /** CLOSED → OPEN 전환 임계값 (연속 실패 N회 시 OPEN). 기본 5. */
  failureThreshold: number
  /** OPEN 상태 지속 시간 (ms). cooldown 경과 후 HALF_OPEN 자동 전환. 기본 30_000. */
  cooldownMs: number
  /** HALF_OPEN trial 허용 횟수. 모든 trial 성공 시 CLOSED 복귀. 기본 3. */
  halfOpenTrial: number
  /** CLOSED 상태 failureCount 자연 리셋 윈도우 (ms). 기본 60_000. */
  resetWindowMs: number
}

/**
 * Circuit Breaker 통계 (디버깅 + 운영 모니터링).
 *
 * - state: 현재 상태 (CLOSED / OPEN / HALF_OPEN)
 * - failureCount: 현재 누적 실패 카운터 (CLOSED 영역에서 reset window 후 0 리셋)
 * - openedAt: OPEN 진입 시각 (cooldown 경과 판정용)
 * - halfOpenAt: HALF_OPEN 진입 시각 + trial 카운팅용
 * - halfOpenTrialCount: HALF_OPEN trial 시도 누적 (halfOpenTrial 도달 시 평가)
 * - halfOpenSuccessCount: HALF_OPEN trial 성공 누적
 * - lastSuccessAt / lastFailureAt: 호출 성공/실패 시각 박제
 */
export interface CircuitBreakerStats {
  state: CircuitBreakerState
  failureCount: number
  openedAt?: Date
  halfOpenAt?: Date
  halfOpenTrialCount: number
  halfOpenSuccessCount: number
  lastSuccessAt?: Date
  lastFailureAt?: Date
}

/**
 * Circuit Breaker OPEN 상태 시 fail-fast 분기용 도메인 예외.
 *
 * 호출자 (payment.usecase.ts) 영역에서 catch + AuditLog `circuit_breaker.reject` 박제 분기.
 * 본 예외는 SDK 실제 호출 0건 정합 — retry queue 박제 0건 강제 (사용자 5/10 정합).
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitKey: string,
    public readonly stats: CircuitBreakerStats,
  ) {
    super(`Circuit breaker OPEN — ${circuitKey} (failureCount=${stats.failureCount})`)
    this.name = 'CircuitOpenError'
  }
}
