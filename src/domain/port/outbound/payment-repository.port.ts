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
   * @deprecated CC-2a (2026-05-20) — 충전 적립이 신 포인트 원장(`CreditLedger`)으로 이행됨.
   * 충전 success 경로는 `completePaymentWithPoints`를 사용한다.
   * 본 메서드는 구 `Author.credits` Int + `CreditLog` 박제 경로 — CC-2b(선물·환불) 완결 후 회귀
   * 안전이 확보되면 일괄 제거. 그때까지 호출처 0건 상태로 잔존(계획 §3 C3c / §9 rollback).
   *
   * 결제 완료 원자 처리 — payment 상태 + 크레딧 증가 + 로그 기록을 단일 트랜잭션으로 실행
   * 하나라도 실패하면 전부 롤백 (돈 냈는데 크레딧 안 들어오는 사고 방지)
   */
  completePaymentAtomically(paymentId: string, authorId: string, credits: number, productId: string): Promise<void>

  /**
   * 결제 완료 + 충전 포인트 적립 원자 처리 (CC-2a 신설 — 案 1 트랜잭션 통합).
   *
   * 진단 정본: `reports/CREDIT_CORE_DIAGNOSIS.md` §1-A(T3 충전) + §6-2(settleDeficit 완결).
   * 계획 정본: `.claude/state/sprint-cc2a-charge-wiring-plan-draft.md` §2-2 案 1 / §3.
   *
   * CLAUDE.md §9 결제 원자성 절대 규칙 — 아래 전부를 단일 `$transaction`으로 묶는다.
   * 하나라도 실패하면 전부 롤백 ("돈은 냈는데 포인트 없음"은 절대 불가):
   *   1. Payment status='completed' + completedAt
   *   2. deficit(외상) 우선 상계 — settledDeficit > 0 시 `CreditLedger` type='deficit_settle' row
   *      + `Author.deficitPoints` 차감 (충전 즉시 최우선 — §8-4)
   *   3. 남은 충전액 적립 — remainingCharge > 0 시 `CreditLedger` source='charged' type='earn' row
   *      + `Author.pointsCharged` 캐시 가산
   *
   * 금액 계산은 도메인 순수 함수 `computeChargeLedgerEntries`에 위임 — `settleDeficit`/`earn`
   * 어댑터와 동일 회계(상계분은 캐시 적립 제외). 구 `CreditLog` 박제는 하지 않는다
   * (CC-1이 적립을 `CreditLedger`로 완전 이행 — 계획 S0 C1b→C3d 분기).
   *
   * @param paymentId 완료 처리할 Payment id
   * @param authorId 적립 대상 Author id
   * @param totalPoints 충전 패키지 총 포인트 (기본 + 보너스 — §8-5, pt 단위. 양수)
   * @param productId 상품 id (감사 reason 박제용)
   * @param relatedId Payment id 약결합 (`CreditLedger.relatedId` — 보통 paymentId 와 동일)
   * @returns settledDeficit(상계된 외상 pt), chargedPoints(실제 적립된 충전 pt)
   */
  completePaymentWithPoints(
    paymentId: string,
    authorId: string,
    totalPoints: number,
    productId: string,
    relatedId?: string,
  ): Promise<{ settledDeficit: number; chargedPoints: number }>

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
