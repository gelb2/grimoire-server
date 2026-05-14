/**
 * 결제 도메인 status enum + Polar 매핑 정책 (Sprint PAY-P3-D, 2026-05-15)
 *
 * **본 파일 영역 = 도메인 model (DIP 정합 — Prisma/NestJS import 0건 강제)**
 *
 * 박제 영역 (분산되어 있던 status literal 통합):
 * - `PaymentStatus`: DB `payments.status` 컬럼 값 enum (pending/completed/failed/refunded/partial_refunded)
 * - `WebhookEventStatus`: DB `webhook_events.status` 컬럼 값 enum (processed/skipped/failed)
 * - `NormalizedWebhookStatus`: Port `NormalizedWebhookEvent.status` 정규화 어휘 (success/fail/cancel)
 * - `NormalizedCheckoutStatus`: Port `NormalizedCheckout.status` 정규화 어휘 (succeeded/refunded/failed/open)
 * - `RefundSource`: RefundLog source 어휘 (webhook/manual)
 *
 * 매핑 함수 (Polar SDK string literal → 도메인 enum):
 * - `mapPolarOrderStatus()`: Polar order.status → NormalizedWebhookStatus
 *   - 정본 위치 영역 박제 (polar.adapter.ts private mapOrderStatus 영역 도메인 이전, 호출자 패턴 유지)
 * - `mapPolarCheckoutStatus()`: Polar checkout.status → NormalizedCheckoutStatus
 *   - 정본 위치 영역 박제 (polar.adapter.ts private mapCheckoutStatus 영역 도메인 이전)
 *
 * 정본:
 * - `.claude/shared-contracts.md §28 PaymentStatusMapping`
 * - `ADR.md §ADR-010` (enum 도입 결정 + 대안 박제)
 *
 * **DB schema 변경 0건 강제** (사용자 5/10 verbatim 정합):
 * - Prisma schema 영역 status 컬럼 `String` 유지 (enum 변환 X — dev migration 0건)
 * - 본 enum 영역 = TypeScript 도메인 layer만 (Runtime 검증 + 어휘 통일 목적)
 * - 향후 DB enum 변환 영역은 별도 sprint (PAY-P4-x 영역 후보)
 *
 * **외부 npm 라이브러리 추가 0건** + **외부 Anthropic API 의존 0건** 정합.
 */

// ============================================================================
// 1. 도메인 enum (TypeScript 어휘 통일)
// ============================================================================

/**
 * Payment.status (DB `payments.status` 컬럼 어휘).
 * - pending: initiatePayment 직후 (Polar checkout 진입 전 박제)
 * - completed: order.paid webhook 수신 + completePaymentAtomically 종료
 * - failed: webhook fail 수신 또는 Polar SDK 결함 (permanent_failed 박제)
 * - refunded: 전액 환불 종료 (refundPaymentAtomically + RefundLog 박제)
 * - partial_refunded: 부분 환불 종료 (PAY-P2-1 PartialRefund 정합)
 */
export const PAYMENT_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIAL_REFUNDED: 'partial_refunded',
} as const

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS]

/**
 * 환불 가능 상태 (전액 또는 부분 환불 진입 게이트).
 * `payment.usecase.ts` 영역 race condition 차단 게이트 (정본: shared-contracts §22).
 */
export const REFUNDED_STATES: ReadonlyArray<PaymentStatus> = [
  PAYMENT_STATUS.REFUNDED,
  PAYMENT_STATUS.PARTIAL_REFUNDED,
] as const

/**
 * WebhookEvent.status (DB `webhook_events.status` 컬럼 어휘).
 * - processed: completePaymentAtomically 또는 refundPaymentAtomically 종료
 * - skipped: 중복/unknown_trade/already_completed 등 안전 skip
 * - failed: SDK 결함 또는 트랜잭션 결함 박제
 */
export const WEBHOOK_EVENT_STATUS = {
  PROCESSED: 'processed',
  SKIPPED: 'skipped',
  FAILED: 'failed',
} as const

export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUS)[keyof typeof WEBHOOK_EVENT_STATUS]

/**
 * NormalizedWebhookEvent.status (Port 정규화 어휘).
 * payment-gateway.port.ts NormalizedWebhookEvent.status literal type 정합.
 * - success: order.paid / order.updated / checkout.updated (status='succeeded')
 * - cancel: order.refunded / checkout.updated (환불 어휘)
 * - fail: checkout.updated (status='failed' or 'expired') / 그 외 분류 실패
 */
export const NORMALIZED_WEBHOOK_STATUS = {
  SUCCESS: 'success',
  FAIL: 'fail',
  CANCEL: 'cancel',
} as const

export type NormalizedWebhookStatus =
  (typeof NORMALIZED_WEBHOOK_STATUS)[keyof typeof NORMALIZED_WEBHOOK_STATUS]

/**
 * NormalizedCheckout.status (Port 정규화 어휘 — PAY-P0-2 reconciliation 정합).
 * payment-gateway.port.ts NormalizedCheckout.status literal type 정합.
 * - succeeded: 결제 종료 (S1 boost 후보)
 * - refunded: 환불 종료 (S2 mismatch 후보 — 단 checkout 단계 status X order 단계)
 * - failed: expired / failed
 * - open: 사용자 결제 진행 중 (confirmed 단계 포함 — webhook 미발송 가능)
 */
export const NORMALIZED_CHECKOUT_STATUS = {
  SUCCEEDED: 'succeeded',
  REFUNDED: 'refunded',
  FAILED: 'failed',
  OPEN: 'open',
} as const

export type NormalizedCheckoutStatus =
  (typeof NORMALIZED_CHECKOUT_STATUS)[keyof typeof NORMALIZED_CHECKOUT_STATUS]

/**
 * RefundLog.source 어휘.
 * - webhook: Polar order.refunded webhook 자동 처리
 * - manual: 운영자 수동 처리 (P2 영역)
 */
export const REFUND_SOURCE = {
  WEBHOOK: 'webhook',
  MANUAL: 'manual',
} as const

export type RefundSource = (typeof REFUND_SOURCE)[keyof typeof REFUND_SOURCE]

// ============================================================================
// 2. 매핑 함수 (Polar string literal → 도메인 enum)
// ============================================================================

/**
 * Polar order.status → NormalizedWebhookStatus 매핑.
 *
 * **호출 위치**: `polar.adapter.ts:verifyAndParseWebhook` 영역 `order.paid`/`order.updated` 분기.
 *
 * Polar 문서 정본:
 * - https://docs.polar.sh/api-reference/orders
 * - paid/succeeded: 결제 종료 → `success`
 * - refunded: 환불 종료 → `cancel` (크레딧 환수 분기 진입)
 * - 그 외 (pending/canceled/...): 안전 측면 `fail` fallback
 *
 * @param status Polar order.status (string | undefined)
 * @returns NormalizedWebhookStatus (success / cancel / fail)
 */
export function mapPolarOrderStatus(status?: string): NormalizedWebhookStatus {
  switch (status) {
    case 'paid':
    case 'succeeded':
      return NORMALIZED_WEBHOOK_STATUS.SUCCESS
    case 'refunded':
      return NORMALIZED_WEBHOOK_STATUS.CANCEL
    default:
      return NORMALIZED_WEBHOOK_STATUS.FAIL
  }
}

/**
 * Polar checkout.status → NormalizedCheckoutStatus 매핑.
 *
 * **호출 위치**: `polar.adapter.ts:listRecentCheckouts` 영역 (PAY-P0-2 reconciliation cron 정합).
 *
 * Polar 문서 정본:
 * - https://docs.polar.sh/api-reference/checkouts
 * - succeeded: 결제 종료
 * - expired / failed: 결제 결함 (실패 박제)
 * - open: 사용자 결제 진행 중
 * - confirmed: 결제 확인 단계 (webhook 미발송 가능 — `open` 동일 취급)
 * - 그 외 (canceled 등 미정의 status): 안전 측면 `failed` fallback
 *
 * **refund 영역 미박제**: checkout 단계 status X (order 단계만 refunded 발생).
 * S2 mismatch 영역은 webhook 의존 (reconciliation.job 정합).
 *
 * **기존 polar.adapter.ts:mapCheckoutStatus 동작 보존 정합**:
 * - default → `open` (사용자 결제 진행 중 영역 안전 측면 — `failed` fallback X)
 * - 이유: reconciliation cron 영역 (PAY-P0-2) S2 mismatch 영역 X 신호 (false positive 차단)
 *
 * @param status Polar checkout.status (string | undefined)
 * @returns NormalizedCheckoutStatus (succeeded / refunded / failed / open)
 */
export function mapPolarCheckoutStatus(status?: string): NormalizedCheckoutStatus {
  switch (status) {
    case 'succeeded':
      return NORMALIZED_CHECKOUT_STATUS.SUCCEEDED
    case 'expired':
    case 'failed':
      return NORMALIZED_CHECKOUT_STATUS.FAILED
    case 'open':
    case 'confirmed':
      return NORMALIZED_CHECKOUT_STATUS.OPEN
    default:
      // 기존 polar.adapter.ts:mapCheckoutStatus 동작 보존 — default → 'open' (reconciliation false positive 차단)
      return NORMALIZED_CHECKOUT_STATUS.OPEN
  }
}

/**
 * Payment.status → 환불 가능 여부 게이트.
 *
 * **호출 위치**: `payment.usecase.ts:processNormalizedWebhook` 영역
 * `payment.status === 'refunded' || payment.status === 'partial_refunded'` 체크 영역.
 *
 * 향후 race condition 차단 게이트 통합 시 본 helper 사용 (shared-contracts §22 정합).
 *
 * @param status 현재 Payment.status
 * @returns true: 이미 환불됨 (재처리 차단), false: 환불 가능
 */
export function isPaymentAlreadyRefunded(status: string): boolean {
  return (REFUNDED_STATES as ReadonlyArray<string>).includes(status)
}

/**
 * Polar order.status가 환불 종료 어휘인지 판정.
 *
 * **호출 위치**: 향후 `polar.adapter.ts` 분기 통합 시 사용 (현재 switch 영역 직접 비교).
 *
 * @param status Polar order.status (string | undefined)
 * @returns true: 환불 종료, false: 그 외
 */
export function isPolarRefundedStatus(status?: string): boolean {
  return status === 'refunded'
}

/**
 * Polar order.status가 결제 종료 어휘인지 판정.
 *
 * @param status Polar order.status (string | undefined)
 * @returns true: 결제 종료, false: 그 외
 */
export function isPolarSuccessStatus(status?: string): boolean {
  return status === 'paid' || status === 'succeeded'
}
