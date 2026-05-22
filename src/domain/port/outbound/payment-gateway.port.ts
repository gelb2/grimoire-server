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
 * CC-5 (PAY-P1-4) — Polar 구독 생명주기 webhook 정규화 결과.
 *
 * 별도 타입 분리 — 일회성 충전 `NormalizedWebhookEvent`(status 3값 success/fail/cancel)는
 * 구독 생명주기(created/updated/canceled/revoked)를 표현하지 못한다(C5a 案 — 타입 분리 채택).
 *
 * - created/updated → `MembershipPlanPort.changeTier(authorId, tier)` (구독 가입/등급 변경)
 * - canceled/revoked → `changeTier(authorId, 'free')` (free 다운그레이드)
 *
 * 정기결제 갱신(매월 `order.paid` 재발행, tier 불변)은 `NormalizedWebhookEvent` 로 처리 —
 * 풀 리셋은 cron 단독 책임 (정합 정책 案 A 분리, plan-draft §8).
 */
export interface NormalizedSubscriptionEvent {
  /** PG 발급 unique 이벤트 식별자 (멱등성 게이트 키 — `webhook-id` 헤더). */
  eventId: string
  /** 이벤트 타입 — 'subscription.created' / 'subscription.updated' 등 (원본 보존). */
  type: string
  /** 구독 생명주기 — webhook usecase 의 분기 키. */
  lifecycle: 'created' | 'updated' | 'canceled' | 'revoked'
  /** Polar 구독 ID (`data.id`) — `MembershipPlan.polarSubscriptionId` 매핑 키. */
  polarSubscriptionId: string
  /** 구독 등급 (Polar product ID 역매핑 또는 metadata.tier). canceled/revoked 시 'free'. */
  tier: 'free' | 'pro' | 'premium'
  /** 구독 작가 ID (metadata.authorId). 누락 시 webhook 무시. */
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

/**
 * CC-5 — webhook 정규화 결과 판별: 구독 생명주기 이벤트인지 여부.
 *
 * `verifyAndParseWebhook` 가 충전(`NormalizedWebhookEvent`)/구독(`NormalizedSubscriptionEvent`)
 * 양쪽을 반환 → usecase 가 이 가드로 라우팅 분기.
 */
export function isSubscriptionEvent(
  event: NormalizedWebhookEvent | NormalizedSubscriptionEvent,
): event is NormalizedSubscriptionEvent {
  return 'lifecycle' in event
}

export interface PaymentGatewayPort {
  /** 결제 요청 시작 — 호스티드 체크아웃 URL 반환 */
  initiatePayment(request: PaymentInitRequest): Promise<PaymentInitResponse>

  /**
   * 웹훅 원본을 검증하고 정규화된 이벤트로 반환.
   * 서명 검증 실패 시 null 반환.
   * 처리 대상 이벤트가 아닐 경우에도 null 반환 (무시).
   *
   * CC-5 (PAY-P1-4) — 충전(`NormalizedWebhookEvent`) + 구독(`NormalizedSubscriptionEvent`)
   * 양쪽을 반환. 호출자는 `isSubscriptionEvent` 가드로 라우팅 분기.
   */
  verifyAndParseWebhook(
    rawBody: Buffer | string,
    headers: Record<string, string>,
  ): NormalizedWebhookEvent | NormalizedSubscriptionEvent | null

  /**
   * CC-5 (PAY-P1-4) — 구독 정기결제 Checkout 세션 생성.
   *
   * recurring product 를 전달하면 Polar 가 정기결제 모드로 자동 처리.
   * env(`POLAR_PRODUCT_SUBSCRIPTION_{tier}`) 미설정 시 null 반환 — 호출자가 503 graceful 분기.
   *
   * Optional 메서드 — 미구현 adapter 에서는 호출자가 null 처리(graceful §4).
   *
   * @param tier 구독 등급 ('pro' | 'premium' — 'free' 는 checkout 불가)
   * @param userId 구독 작가 ID (metadata.authorId 박제)
   * @param returnUrl 결제 완료 후 리다이렉트 웹 URL
   * @returns 호스티드 URL + tradeNo, 또는 env 미설정 시 null
   */
  initiateSubscriptionCheckout?(
    tier: 'pro' | 'premium',
    userId: string,
    returnUrl: string,
  ): Promise<PaymentInitResponse | null>

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
