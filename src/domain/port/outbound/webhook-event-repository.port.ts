/**
 * 웹훅 이벤트 멱등성 리포지토리 포트
 *
 * 결제 PG (Polar 등) 웹훅 재전송 시 동일 eventId로 두 번째 호출이 들어와도
 * `completePaymentAtomically`가 단 1회만 실행되도록 DB unique 제약으로 race 차단.
 *
 * Sprint: PAY-P0-1 (2026-05-03)
 * 정본: `.claude/shared-contracts.md` §11 WebhookEventIdempotency
 */

export type WebhookEventStatus = 'processed' | 'skipped' | 'failed'

export interface WebhookEventRecord {
  id: string
  eventId: string
  source: string
  eventType: string
  status: WebhookEventStatus
  processedAt: Date
}

export interface WebhookEventCreateInput {
  eventId: string
  source: string
  eventType: string
  payload: object
  status?: WebhookEventStatus
  errorMessage?: string | null
}

export interface WebhookEventRepositoryPort {
  /** eventId 박제 여부 조회 — 발견 시 record 반환 (중복 차단 게이트). */
  findByEventId(eventId: string): Promise<WebhookEventRecord | null>

  /**
   * eventId 박제 — eventId @unique 위반(Prisma P2002) 시 null 반환 (race 안전).
   *
   * 동작:
   * - 신규 INSERT 성공 → WebhookEventRecord 반환
   * - eventId 중복 (다른 worker가 먼저 INSERT 완료) → null 반환 (예외 throw 금지)
   * - 그 외 예외 → 그대로 throw (caller가 처리)
   */
  createIfAbsent(input: WebhookEventCreateInput): Promise<WebhookEventRecord | null>

  /** 기존 record의 status 갱신 (failed → retry processed 시 등). */
  markStatus(eventId: string, status: WebhookEventStatus, errorMessage?: string): Promise<void>
}
