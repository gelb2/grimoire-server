/**
 * SMS 서비스 포트 — provider 무관 캡슐화 (Hexagonal). PAY-P2-3 사전 작업.
 *
 * 정본: `.claude/shared-contracts.md` §19 SmsServicePort + `reports/PAY-P2-MASTER-PLAN.md` §5
 *
 * Provider 매트릭스 (사용자 절대 규정 0-1 결정 게이트):
 * - NullSmsAdapter (default) — 외부 API 0건, logger.warn만, isEnabled()=false
 * - KakaoBizmessageAdapter (사용자 결정 후) — 카카오 알림톡/친구톡 (한국 사용자 우선 추천)
 * - NhnCloudSmsAdapter (사용자 결정 후) — NHN Cloud SMS API
 * - TwilioSmsAdapter (보류) — 글로벌 USD
 *
 * env `SMS_PROVIDER=null|kakao|nhn|twilio` 분기 → app.module DI factory.
 * UseCase는 본 인터페이스만 의존 — provider 변경 시 UseCase 코드 변경 0건.
 *
 * EmailServicePort 패턴 정합 (research/EMAIL_INTEGRITY_PLAN.md §12 차용).
 */

export type SmsProvider = 'null' | 'kakao' | 'nhn' | 'twilio'

/**
 * 결제 알림 SMS 타입 — EmailServicePort.PaymentNotificationType 정합.
 * 사용자가 SMS provider 결정 후 진입할 트리거.
 */
export type PaymentSmsType = 'payment_success' | 'payment_failed' | 'payment_refunded'

export interface SmsSendResult {
  /** Provider가 발급한 메시지 ID (Null이면 null) */
  messageId: string | null
  /** 발송 시도한 provider 식별자 */
  provider: SmsProvider
}

export interface SmsServicePort {
  /**
   * 결제 알림 SMS 발송 (성공 / 실패 / 환불).
   *
   * payload는 type별 고정 키 (EmailServicePort.sendPaymentNotification 정합):
   * - payment_success: { paymentId, amount, credits, productName }
   * - payment_failed: { paymentId, amount, productName }
   * - payment_refunded: { paymentId, refundedAmount, credits, deficitCredits, reason, isPartial }
   *
   * @param input.to E.164 형식 권장 (예: +821012345678) — provider별 정규화는 adapter 책임
   * @param input.displayName 작가 표시명 (인사말 박제용, 선택)
   */
  sendPaymentNotification(input: {
    to: string
    type: PaymentSmsType
    displayName?: string
    payload: Record<string, unknown>
  }): Promise<SmsSendResult>

  /**
   * 인증 코드 SMS 발송 (예: 회원가입 본인인증, 비밀번호 초기화 2FA).
   * 향후 EMAIL-P1-1 / 회원가입 보안 강화 시 호출 — 본 sprint OUT.
   *
   * @param input.code 6자리 숫자 권장 (provider별 길이 제약 검증은 adapter)
   * @param input.expireAt 코드 만료 시각 (UI 표시용)
   */
  sendVerificationCode(input: {
    to: string
    code: string
    displayName?: string
    expireAt: Date
  }): Promise<SmsSendResult>

  /** Provider 활성화 여부 (env 미박제 시 false → NullAdapter) */
  isEnabled(): boolean

  /** Provider 식별자 (로그 / 감사용) */
  getProviderName(): SmsProvider
}
