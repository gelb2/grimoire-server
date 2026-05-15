import {
  CircuitBreakerState,
  CircuitBreakerStats,
} from '@domain/model/circuit-breaker-state'

/**
 * Circuit Breaker outbound port — PAY-P3-H (2026-05-15)
 *
 * Polar SDK 호출 경계 가용성 차단 (Hystrix 3 상태 머신 정합).
 * 정본: `.claude/shared-contracts.md §27 CircuitBreakerPolicy`
 *
 * 호출점별 독립 상태 (한 호출점 OPEN 시 다른 호출점 영향 0).
 * 본 sprint 3 호출점: `polar:checkouts:create` / `polar:checkouts:list` / `polar:checkouts:get`.
 *
 * 본 파일 = 순수 인터페이스 (NestJS / Prisma import 0건 강제).
 */
export interface CircuitBreakerPort {
  /**
   * 호출 래핑 — circuit breaker 정책 적용 후 fn() 실행.
   *
   * - CLOSED: fn() 실행. 실패 시 failureCount++ (임계값 초과 → OPEN 전환).
   * - OPEN: 즉시 CircuitOpenError throw (fn() 호출 0건). cooldown 경과 시 HALF_OPEN 자동 전환.
   * - HALF_OPEN: trial 횟수 미달 시 fn() 실행. 성공 누적 (halfOpenTrial 도달 시 CLOSED 복귀).
   *             실패 시 즉시 OPEN 복귀 (cooldown 재시작).
   *
   * @param key 호출점 식별자 (예: `polar:checkouts:create`)
   * @param fn 보호 대상 비동기 함수
   * @returns fn() 반환값 (성공 시) 또는 CircuitOpenError throw (OPEN 상태 시)
   */
  execute<T>(key: string, fn: () => Promise<T>): Promise<T>

  /**
   * 현재 상태 조회 (디버깅 + 테스트 영역).
   * 미진입 key 조회 시 CLOSED 반환 (lazy init 정합).
   */
  getState(key: string): CircuitBreakerState

  /**
   * 현재 통계 조회 (failureCount / openedAt / halfOpenAt 등).
   * 미진입 key 조회 시 초기 stats 반환 (state=CLOSED, failureCount=0).
   */
  getStats(key: string): CircuitBreakerStats

  /**
   * 강제 OPEN — 운영자 수동 차단.
   * 본 sprint = port 정의만 (관리자 UI 영역은 P3-I 별도 sprint 분리).
   *
   * @param key 호출점 식별자
   * @param reason 차단 사유 (AuditLog `circuit_breaker.open` 박제용)
   */
  forceOpen(key: string, reason: string): Promise<void>

  /**
   * 강제 CLOSED — 운영자 수동 복구.
   * 본 sprint = port 정의만 (관리자 UI 영역은 P3-I 별도 sprint 분리).
   *
   * @param key 호출점 식별자
   * @param reason 복구 사유 (AuditLog `circuit_breaker.close` 박제용)
   */
  forceClose(key: string, reason: string): Promise<void>
}
