/**
 * 웹훅 재시도 큐 리포지토리 포트 (PAY-P2-2 — Postgres 기반 DLQ)
 *
 * 결제 PG webhook 처리 실패 시 재시도 큐에 박제.
 * WebhookRetryJob @Cron 5분이 due row를 처리.
 *
 * 외부 인프라 의존 0건 (Redis/ServiceBus/Kafka 미사용 — 절대 규정 0-1 정합).
 *
 * Sprint: PAY-P2-2 (2026-05-05)
 * 정본: `.claude/shared-contracts.md` §18 WebhookDLQ + `reports/PAY-P2-MASTER-PLAN.md` §4
 */

export interface WebhookRetryQueueRecord {
  id: string
  eventId: string
  payload: unknown // NormalizedWebhookEvent JSON
  retryCount: number
  lastError: string | null
  nextRetryAt: Date
  createdAt: Date
}

export interface WebhookRetryQueueUpsertInput {
  eventId: string
  payload: object
  nextRetryAt: Date
}

export interface WebhookRetryQueueRepositoryPort {
  /**
   * 재시도 큐 박제 (멱등성 — eventId @unique).
   *
   * 동작:
   * - 신규 INSERT 성공 → record 반환 (retryCount=0)
   * - eventId 중복 시 기존 row 갱신 0건 (createdAt 보존, retryCount는 markRetry로만 증가)
   *   → null 반환 (race 차단)
   * - 그 외 예외 → throw (caller가 처리)
   */
  upsert(input: WebhookRetryQueueUpsertInput): Promise<WebhookRetryQueueRecord | null>

  /**
   * 처리 가능 row 조회 — nextRetryAt <= now() ORDER BY nextRetryAt ASC LIMIT N.
   *
   * @param now 기준 시각 (보통 new Date())
   * @param limit 최대 row 수 (기본 100)
   */
  findDue(now: Date, limit?: number): Promise<WebhookRetryQueueRecord[]>

  /**
   * 성공 시 row 삭제.
   *
   * @param id 큐 row id
   */
  deleteById(id: string): Promise<void>

  /**
   * 실패 시 retryCount++ + lastError + nextRetryAt 갱신.
   *
   * @param id 큐 row id
   * @param error 마지막 실패 메시지 (앞 500자만 박제)
   * @param nextRetryAt 다음 재시도 시각 (caller가 백오프 계산)
   */
  markRetry(id: string, error: string, nextRetryAt: Date): Promise<void>

  /**
   * eventId로 조회 (운영자 디버깅용 + spec 검증).
   */
  findByEventId(eventId: string): Promise<WebhookRetryQueueRecord | null>
}
