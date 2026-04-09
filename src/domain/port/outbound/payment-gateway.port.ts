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
}
