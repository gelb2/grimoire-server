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
}
