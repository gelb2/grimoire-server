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
   * 환불 원자 처리 — payment 상태 + 크레딧 환수 + CreditLog 음수 + RefundLog를 단일 트랜잭션으로 실행
   * (Sprint PAY-P1-1, 2026-05-03 — 정본: `.claude/shared-contracts.md` §13)
   *
   * 분기:
   * - Author.credits >= credits: 정상 환수 (actualDeducted=credits, deficitCredits=0)
   * - Author.credits < credits: 0 fix (actualDeducted=잔액, deficitCredits=credits-잔액). 음수 절대 차단.
   *
   * @param input.paymentId 환불 대상 Payment id
   * @param input.authorId 환수 대상 Author id
   * @param input.credits 환수할 크레딧 (양수 입력)
   * @param input.refundedAmount PG 환불 금액 (KRW)
   * @param input.reason 환불 사유 (예: 'polar_webhook_order.refunded')
   * @param input.source 'webhook' | 'manual'
   * @returns actualDeducted (실제 차감 크레딧), deficitCredits (잔액 부족분)
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
  }>
}
