/** 결제 게이트웨이 포트 — 결제 제공자에 독립적 */

export interface PaymentInitRequest {
  productId: string
  productName: string
  amount: number
  userId: string
  returnUrl: string
}

export interface PaymentInitResponse {
  paymentUrl: string
  tradeNo: string
}

export interface WebhookPayload {
  tradeNo: string
  amount: number
  status: string // 'success' | 'fail' | 'cancel'
  signature: string
}

export interface PaymentGatewayPort {
  /** 결제 요청 시작 */
  initiatePayment(request: PaymentInitRequest): Promise<PaymentInitResponse>
  /** 웹훅 서명 검증 — 시크릿은 어댑터가 자체 관리 */
  verifyWebhookSignature(payload: WebhookPayload): boolean
}
