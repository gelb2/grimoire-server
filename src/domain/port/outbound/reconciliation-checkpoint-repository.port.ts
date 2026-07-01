/**
 * PG↔DB 정합성 검증 cron checkpoint Port — Sprint PAY-P0-2 (2026-05-03).
 *
 * 단일 row 보장 (id='singleton'). cron 실행마다 동일 row를 upsert.
 * 책 Ch 16 "shared state via DB single-row checkpoint" 패턴 차용.
 */

export interface ReconciliationCheckpointRecord {
  /** 항상 'singleton' */
  id: string
  /** 마지막 cron 실행 시작 시각 (다음 cron의 since 필터 입력) */
  lastRunAt: Date
  /** 마지막 실행에서 처리한 row 수 (전체) */
  processedCount: number
  /** 자동 보정한 row 수 (S1 boost) */
  boostCount: number
  /**
   * 정합 이상 탐지 row 수 — S2 refund mismatch + R2 amount mismatch 합산.
   * (스키마 무변경 최소 변경 — 세부 구분은 AuditLog action
   *  `reconciliation_refund_mismatch` / `reconciliation_amount_mismatch` 로 조회.)
   */
  mismatchCount: number
  /** pending 만료 처리 row 수 (S3 expire) */
  expireCount: number
  /** 마지막 실행 중 발생한 예외 메시지 (null이면 정상) */
  errorMessage: string | null
  /** 갱신 시각 */
  updatedAt: Date
}

export interface ReconciliationCheckpointRepositoryPort {
  /**
   * singleton row 조회 — 미존재 시 default seed 반환 (lastRunAt = 24h 전).
   * 마이그레이션에서 INSERT seed 1회 박제하지만, 안전망으로 default seed 처리도 포함.
   */
  findSingleton(): Promise<ReconciliationCheckpointRecord>

  /**
   * singleton row 갱신 (upsert) — 항상 id='singleton'.
   */
  update(data: {
    lastRunAt: Date
    processedCount: number
    boostCount: number
    mismatchCount: number
    expireCount: number
    errorMessage?: string | null
  }): Promise<ReconciliationCheckpointRecord>
}
