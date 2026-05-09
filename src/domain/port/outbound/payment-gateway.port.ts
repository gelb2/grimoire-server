/**
 * 결제 게이트웨이 포트 — 결제 제공자에 독립적
 *
 * 현재 구현체: PolarAdapter (Polar, MoR)
 * 과거 구현체: PayappAdapter (AI 콘텐츠 카드사 심사 리스크로 폐기)
 */

export interface PaymentInitRequest {
  /** 내부 상품 ID (credit-10, credit-30, ...) */
  productId: string
  /** 상품명 (로깅/표시용) */
  productName: string
  /** 결제 금액 (원화 — 내부 기준, 실제 결제 통화는 어댑터가 결정) */
  amount: number
  /** 결제 작가 ID */
  userId: string
  /** 결제 완료 후 리다이렉트할 웹 URL */
  returnUrl: string
}

export interface PaymentInitResponse {
  /** 사용자에게 노출할 호스티드 체크아웃 URL */
  paymentUrl: string
  /** 외부 거래 ID (Polar의 경우 checkout ID) */
  tradeNo: string
}

/** 웹훅 이벤트 정규화 결과 — 어댑터가 파싱해서 반환 */
export interface NormalizedWebhookEvent {
  /**
   * PG가 발급하는 unique 이벤트 식별자 (Polar의 경우 `webhook-id` 헤더).
   * WebhookEvent 멱등성 게이트(Sprint PAY-P0-1)에서 중복 차단 키로 사용.
   * 어댑터가 헤더를 추출 못하면 이벤트 자체를 무시(null 반환) — 멱등성 보장 불가 시 안전 거부.
   */
  eventId: string
  /** 이벤트 타입 — 'order.paid' / 'order.refunded' / 'checkout.updated' 등 */
  type: string
  /** 우리가 DB에 저장한 tradeNo와 매칭할 외부 거래 ID */
  tradeNo: string
  /** 결제 금액 (어댑터가 최소 단위 → 원화 변환) */
  amount: number
  /** 정규화된 상태 */
  status: 'success' | 'fail' | 'cancel'
  /** 결제 작가 ID (metadata에서 추출) */
  userId?: string
}

/**
 * PAY-P3-B 구멍-C 차단: Polar SDK exception 5분류 매트릭스.
 * 정본: shared-contracts §24 PolarSDKTimeoutPolicy.
 *
 * - timeout: AbortError, TimeoutError, message 'timeout' (retry 의미 있음 — 일시적 장애)
 * - network: ECONNRESET, ENOTFOUND, ETIMEDOUT, EPIPE, ECONNREFUSED (retry 의미 있음)
 * - server_5xx: HTTP 500/502/503/504 (retry 의미 있음 — Polar 서버 일시적 장애)
 * - client_4xx: HTTP 400/401/403/404/422 (retry **무의미** — 요청 결함, 즉시 permanent_failed)
 * - unknown: 분류 실패 시 안전 측면 fallback (retry 가능 영역)
 */
export type PolarErrorClass =
  | 'timeout'
  | 'network'
  | 'server_5xx'
  | 'client_4xx'
  | 'unknown'

export interface PolarErrorClassification {
  errorClass: PolarErrorClass
  /** HTTP status 추출 가능 시만 박제 (server_5xx / client_4xx 분류 시 필수) */
  httpStatus?: number
  /** 원본 에러 메시지 (로깅 + AuditLog detail용 — 500자 이내 truncate 권장) */
  message: string
}

/**
 * 정규화된 PG 측 checkout — Sprint PAY-P0-2 PG↔DB 정합성 검증 cron에서 사용.
 *
 * - PG (Polar)에서 list로 조회한 checkout을 어댑터가 정규화해서 반환.
 * - status는 webhook 정규화와 통일 (success/refunded/failed/open).
 * - amount는 KRW (어댑터가 USD 센트 → KRW 변환).
 * - createdAt: PG checkout 생성 시각 (since 필터 비교용).
 */
export interface NormalizedCheckout {
  /** Polar checkout.id (DB Payment.externalTransactionId와 매칭) */
  externalTransactionId: string
  /** 정규화된 상태 — webhook과 동일 어휘 */
  status: 'succeeded' | 'refunded' | 'failed' | 'open'
  /** 결제 금액 (KRW) */
  amount: number
  /** Polar checkout 생성 시각 */
  createdAt: Date
}

export interface PaymentGatewayPort {
  /** 결제 요청 시작 — 호스티드 체크아웃 URL 반환 */
  initiatePayment(request: PaymentInitRequest): Promise<PaymentInitResponse>

  /**
   * 웹훅 원본을 검증하고 정규화된 이벤트로 반환.
   * 서명 검증 실패 시 null 반환.
   * 처리 대상 이벤트가 아닐 경우에도 null 반환 (무시).
   */
  verifyAndParseWebhook(
    rawBody: Buffer | string,
    headers: Record<string, string>,
  ): NormalizedWebhookEvent | null

  /**
   * PG↔DB 정합성 검증 cron용 — 최근 checkout 목록 조회 (Sprint PAY-P0-2).
   *
   * @param since createdAt 이후 checkout만 반환 (clientSide 필터)
   * @param limit 페이지당 최대 row 수 (Polar SDK 최대 100)
   *
   * 페이지네이션은 어댑터 내부에서 created_at desc 정렬 + since 도달 시 break.
   * Polar SDK는 server-side since 필터 미지원이므로 clientSide 필터링 의무.
   */
  listRecentCheckouts(since: Date, limit: number): Promise<NormalizedCheckout[]>

  /**
   * PAY-P3-B 구멍-C 차단: SDK exception 5분류 (Optional).
   * 정본: shared-contracts §24 PolarSDKTimeoutPolicy.
   *
   * Optional 메서드 — 미구현 adapter (예: 향후 PayApp)에서는 호출자가 'unknown' fallback 처리.
   * payment.usecase가 catch 블록에서 호출 → client_4xx → permanent_failed 즉시 박제, 외 4분류 → retry queue.
   */
  classifyPolarError?(e: unknown): PolarErrorClassification
}
