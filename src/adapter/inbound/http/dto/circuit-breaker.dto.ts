import {
  IsString,
  IsIn,
  IsNotEmpty,
  MinLength,
  MaxLength,
} from 'class-validator'
import {
  CircuitBreakerState,
  CircuitBreakerStats,
} from '@domain/model/circuit-breaker-state'

/**
 * Circuit Breaker admin HTTP DTO — PAY-S3 Phase A (2026-05-23)
 *
 * 정본: `.claude/state/sprint-pay-s3-circuit-breaker-admin-plan-draft.md §5-2`.
 * 정본: `.claude/shared-contracts.md §27 CircuitBreakerPolicy`.
 *
 * 본 DTO 시그니처 변경 시 §27 갱신 동반 (Phase C 메인 영역).
 */

/**
 * 호출점 화이트리스트 — `polar:checkouts:create` / `polar:checkouts:list` 2 값만.
 *
 * Phase A 사용 — controller key validation + AC-6(화이트리스트 외 400).
 * 정본: §27 "호출점별 분리 매트릭스".
 */
export const CIRCUIT_BREAKER_KEYS = [
  'polar:checkouts:create',
  'polar:checkouts:list',
] as const
export type CircuitBreakerKey = (typeof CIRCUIT_BREAKER_KEYS)[number]

/**
 * `POST /admin/circuit-breaker/trip` / `/reset` body DTO.
 *
 * - key: 화이트리스트 2 값만 — 그 외 입력 시 400(BadRequest)
 * - reason: 빈값/공백만 금지 — `@IsNotEmpty` + `@MinLength(1)` — 400(BadRequest)
 *
 * AuditLog `circuit_breaker.manual_trip`/`manual_reset` 박제 reason 정합.
 */
export class CircuitBreakerActionDto {
  @IsString()
  @IsIn(CIRCUIT_BREAKER_KEYS as readonly string[])
  key!: CircuitBreakerKey

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(500)
  reason!: string
}

/**
 * `GET /admin/circuit-breaker/state` 응답 DTO.
 *
 * - key: 호출점 식별자(운영 식별자, 노출 허용 — §S1c 정합)
 * - state/failureCount/openedAt/halfOpenAt/halfOpenTrialCount/halfOpenSuccessCount/lastSuccessAt/lastFailureAt: CircuitBreakerStats 7+1 필드
 * - policy: env 4값(임계치 — secret 아님 — 운영자 정책 가시화)
 *
 * 내부 ID(authorId 등) 노출 0건 정합 — DTO 필드 0개 (Author 모델 미참조).
 */
export class CircuitBreakerStateResponseDto {
  key!: CircuitBreakerKey
  state!: CircuitBreakerState
  failureCount!: number
  openedAt?: string
  halfOpenAt?: string
  halfOpenTrialCount!: number
  halfOpenSuccessCount!: number
  lastSuccessAt?: string
  lastFailureAt?: string
  policy!: {
    /** POLAR_CB_FAILURE_THRESHOLD */
    failureThreshold: number
    /** POLAR_CB_COOLDOWN_MS */
    cooldownMs: number
    /** POLAR_CB_HALF_OPEN_TRIAL */
    halfOpenTrial: number
    /** POLAR_CB_RESET_WINDOW_MS */
    resetWindowMs: number
  }
}

/**
 * `POST /admin/circuit-breaker/trip` / `/reset` 응답 DTO.
 *
 * - success: true (성공 시)
 * - beforeState/afterState: §20 정합 + AuditLog beforeState/afterState 박제와 동일 값
 */
export class CircuitBreakerActionResponseDto {
  success!: true
  beforeState!: CircuitBreakerState
  afterState!: CircuitBreakerState
}

/**
 * 도메인 `CircuitBreakerStats` → 응답 DTO 매핑.
 *
 * Date → ISO 8601 string 직렬화 + policy env 4값 첨부.
 *
 * @param key 호출점 식별자
 * @param stats CircuitBreakerPort.getStats(key) 반환값
 * @param policy 응답에 동봉할 정책 4값 (env 박제값)
 */
export function toCircuitBreakerStateResponse(
  key: CircuitBreakerKey,
  stats: CircuitBreakerStats,
  policy: {
    failureThreshold: number
    cooldownMs: number
    halfOpenTrial: number
    resetWindowMs: number
  },
): CircuitBreakerStateResponseDto {
  return {
    key,
    state: stats.state,
    failureCount: stats.failureCount,
    openedAt: stats.openedAt?.toISOString(),
    halfOpenAt: stats.halfOpenAt?.toISOString(),
    halfOpenTrialCount: stats.halfOpenTrialCount,
    halfOpenSuccessCount: stats.halfOpenSuccessCount,
    lastSuccessAt: stats.lastSuccessAt?.toISOString(),
    lastFailureAt: stats.lastFailureAt?.toISOString(),
    policy,
  }
}
