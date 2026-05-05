export interface PaymentRecord {
  id: string
  authorId: string
  productId: string
  amount: number
  credits: number
  status: string
  externalTransactionId: string | null
  createdAt: Date
  completedAt: Date | null
}

export interface PaymentRepositoryPort {
  create(data: { authorId: string; productId: string; amount: number; credits: number }): Promise<PaymentRecord>
  findByExternalTransactionId(tradeNo: string): Promise<PaymentRecord | null>
  updateExternalTransactionId(paymentId: string, tradeNo: string): Promise<void>
  findByAuthorId(authorId: string): Promise<PaymentRecord[]>

  /**
   * 결제 완료 원자 처리 — payment 상태 + 크레딧 증가 + 로그 기록을 단일 트랜잭션으로 실행
   * 하나라도 실패하면 전부 롤백 (돈 냈는데 크레딧 안 들어오는 사고 방지)
   */
  completePaymentAtomically(paymentId: string, authorId: string, credits: number, productId: string): Promise<void>

  /** 결제 실패/취소 상태 업데이트 */
  updateStatus(paymentId: string, status: string): Promise<void>

  /**
   * pending 상태에서 N시간 이상 경과한 Payment 조회 (Sprint PAY-P0-2 cron 만료 처리).
   * @param hours 경과 시간 (예: 24 → createdAt < NOW() - 24 hours)
   */
  findPendingPaymentsOlderThan(hours: number): Promise<PaymentRecord[]>

  /**
   * pending Payment를 expired 상태로 만료 처리 (Sprint PAY-P0-2).
   * - status='expired' 갱신만 (크레딧 변동 0)
   * - PG record가 NotFound인 pending payment 정리용
   */
  expirePayment(paymentId: string): Promise<void>

  /**
   * Sprint PAY-P1-3 — 결제 실패 retry 정책 (정본: `.claude/shared-contracts.md` §14).
   * 동일 (authorId, productId, status='pending', createdAt > expireSince) Payment 재사용 후보 1건 조회.
   *
   * - WHERE: authorId AND productId AND status='pending' AND createdAt > expireSince
   * - ORDER BY: createdAt DESC (가장 최근 row 우선)
   * - LIMIT: 1
   *
   * 사용처: PaymentUseCase.initiatePayment 진입 게이트
   * - 적중 시 → 동일 paymentId 재사용 + Polar URL 재발급(updateExternalTransactionId)
   * - null 반환 시 → 신규 create
   *
   * @param authorId 결제 시도 작가 id
   * @param productId 상품 id
   * @param expireSince 재사용 가능 기준 시각 (예: now - 24h)
   */
  findReusablePendingPayment(
    authorId: string,
    productId: string,
    expireSince: Date,
  ): Promise<PaymentRecord | null>

  /**
   * 환불 원자 처리 — payment 상태 + 크레딧 환수 + CreditLog 음수 + RefundLog를 단일 트랜잭션으로 실행
   * (Sprint PAY-P1-1 신설, PAY-P2-1 부분 환불 비율 보강 — 정본: `.claude/shared-contracts.md` §13 + §17)
   *
   * 부분 환불 비율 정책 (PAY-P2-1):
   * - ratio = refundedAmount / payment.amount (transaction 내부 조회)
   * - proportionalCredits = ratio === 1.0 ? credits : Math.floor(credits * ratio)
   * - Math.floor 고정 (사용자 우호 — 차감 ↓)
   * - refundedAmount > payment.amount: throw (validation)
   * - payment.amount === 0: throw (free 결제 환불 무의미)
   *
   * 분기:
   * - Author.credits >= proportionalCredits: 정상 환수 (actualDeducted=proportionalCredits, deficitCredits=0)
   * - Author.credits < proportionalCredits: 0 fix (actualDeducted=잔액, deficitCredits=proportionalCredits-잔액). 음수 절대 차단.
   *
   * Payment.status 갱신:
   * - 전액 환불 (ratio === 1.0): 'refunded'
   * - 부분 환불 (ratio < 1.0): 'partial_refunded'
   *
   * @param input.paymentId 환불 대상 Payment id
   * @param input.authorId 환수 대상 Author id
   * @param input.credits 원래 결제 적립 크레딧 (양수 — 비율로 비례 차감)
   * @param input.refundedAmount PG 환불 금액 (KRW) — 전액 시 payment.amount, 부분 시 그 미만
   * @param input.reason 환불 사유 (예: 'polar_webhook_order.refunded')
   * @param input.source 'webhook' | 'manual'
   * @returns actualDeducted, deficitCredits, proportionalCredits, isPartial
   */
  refundPaymentAtomically(input: {
    paymentId: string
    authorId: string
    credits: number
    refundedAmount: number
    reason: string
    source: 'webhook' | 'manual'
  }): Promise<{
    actualDeducted: number
    deficitCredits: number
    proportionalCredits: number
    isPartial: boolean
  }>
}
