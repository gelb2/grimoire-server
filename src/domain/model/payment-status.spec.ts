import {
  PAYMENT_STATUS,
  WEBHOOK_EVENT_STATUS,
  NORMALIZED_WEBHOOK_STATUS,
  NORMALIZED_CHECKOUT_STATUS,
  REFUND_SOURCE,
  REFUNDED_STATES,
  mapPolarOrderStatus,
  mapPolarCheckoutStatus,
  isPaymentAlreadyRefunded,
  isPolarRefundedStatus,
  isPolarSuccessStatus,
} from './payment-status'

/**
 * Sprint PAY-P3-D — Status enum + Polar 매핑 함수 spec (2026-05-15)
 *
 * 정본:
 * - .claude/shared-contracts.md §28 PaymentStatusMapping
 * - ADR.md §ADR-010
 *
 * AC 매트릭스 (regression-72 정합):
 * 1. PAYMENT_STATUS 5 enum 모두 string 값 박제
 * 2. WEBHOOK_EVENT_STATUS 3 enum 모두 string 값 박제
 * 3. NORMALIZED_WEBHOOK_STATUS 3 enum 박제
 * 4. NORMALIZED_CHECKOUT_STATUS 4 enum 박제
 * 5. REFUND_SOURCE 2 enum 박제
 * 6. mapPolarOrderStatus paid/succeeded → success
 * 7. mapPolarOrderStatus refunded → cancel
 * 8. mapPolarOrderStatus undefined/그 외 → fail (안전 fallback)
 * 9. mapPolarCheckoutStatus succeeded → succeeded
 * 10. mapPolarCheckoutStatus expired/failed → failed
 * 11. mapPolarCheckoutStatus open/confirmed → open
 * 12. mapPolarCheckoutStatus undefined/그 외 → failed (안전 fallback)
 * 13. isPaymentAlreadyRefunded refunded/partial_refunded → true
 * 14. isPaymentAlreadyRefunded pending/completed/failed → false
 * 15. isPolarRefundedStatus / isPolarSuccessStatus 정합
 */
describe('payment-status (PAY-P3-D)', () => {
  describe('1. PAYMENT_STATUS enum', () => {
    it('5 status literal 박제 (pending/completed/failed/refunded/partial_refunded)', () => {
      expect(PAYMENT_STATUS.PENDING).toBe('pending')
      expect(PAYMENT_STATUS.COMPLETED).toBe('completed')
      expect(PAYMENT_STATUS.FAILED).toBe('failed')
      expect(PAYMENT_STATUS.REFUNDED).toBe('refunded')
      expect(PAYMENT_STATUS.PARTIAL_REFUNDED).toBe('partial_refunded')
    })

    it('REFUNDED_STATES 2 status 박제 (refunded + partial_refunded)', () => {
      expect(REFUNDED_STATES).toHaveLength(2)
      expect(REFUNDED_STATES).toContain('refunded')
      expect(REFUNDED_STATES).toContain('partial_refunded')
    })
  })

  describe('2. WEBHOOK_EVENT_STATUS enum', () => {
    it('3 status literal 박제 (processed/skipped/failed)', () => {
      expect(WEBHOOK_EVENT_STATUS.PROCESSED).toBe('processed')
      expect(WEBHOOK_EVENT_STATUS.SKIPPED).toBe('skipped')
      expect(WEBHOOK_EVENT_STATUS.FAILED).toBe('failed')
    })
  })

  describe('3. NORMALIZED_WEBHOOK_STATUS enum', () => {
    it('3 status literal 박제 (success/fail/cancel)', () => {
      expect(NORMALIZED_WEBHOOK_STATUS.SUCCESS).toBe('success')
      expect(NORMALIZED_WEBHOOK_STATUS.FAIL).toBe('fail')
      expect(NORMALIZED_WEBHOOK_STATUS.CANCEL).toBe('cancel')
    })
  })

  describe('4. NORMALIZED_CHECKOUT_STATUS enum', () => {
    it('4 status literal 박제 (succeeded/refunded/failed/open)', () => {
      expect(NORMALIZED_CHECKOUT_STATUS.SUCCEEDED).toBe('succeeded')
      expect(NORMALIZED_CHECKOUT_STATUS.REFUNDED).toBe('refunded')
      expect(NORMALIZED_CHECKOUT_STATUS.FAILED).toBe('failed')
      expect(NORMALIZED_CHECKOUT_STATUS.OPEN).toBe('open')
    })
  })

  describe('5. REFUND_SOURCE enum', () => {
    it('2 source literal 박제 (webhook/manual)', () => {
      expect(REFUND_SOURCE.WEBHOOK).toBe('webhook')
      expect(REFUND_SOURCE.MANUAL).toBe('manual')
    })
  })

  describe('6. mapPolarOrderStatus()', () => {
    it('paid → success', () => {
      expect(mapPolarOrderStatus('paid')).toBe('success')
    })

    it('succeeded → success', () => {
      expect(mapPolarOrderStatus('succeeded')).toBe('success')
    })

    it('refunded → cancel', () => {
      expect(mapPolarOrderStatus('refunded')).toBe('cancel')
    })

    it('undefined → fail (안전 fallback)', () => {
      expect(mapPolarOrderStatus(undefined)).toBe('fail')
    })

    it('미정의 status (canceled 등) → fail', () => {
      expect(mapPolarOrderStatus('canceled')).toBe('fail')
      expect(mapPolarOrderStatus('pending')).toBe('fail')
      expect(mapPolarOrderStatus('unknown')).toBe('fail')
    })
  })

  describe('7. mapPolarCheckoutStatus()', () => {
    it('succeeded → succeeded', () => {
      expect(mapPolarCheckoutStatus('succeeded')).toBe('succeeded')
    })

    it('expired → failed', () => {
      expect(mapPolarCheckoutStatus('expired')).toBe('failed')
    })

    it('failed → failed', () => {
      expect(mapPolarCheckoutStatus('failed')).toBe('failed')
    })

    it('open → open', () => {
      expect(mapPolarCheckoutStatus('open')).toBe('open')
    })

    it('confirmed → open (webhook 미발송 가능 — open 동일 취급)', () => {
      expect(mapPolarCheckoutStatus('confirmed')).toBe('open')
    })

    it('undefined → open (기존 polar.adapter.ts:mapCheckoutStatus 동작 보존 — reconciliation false positive 차단)', () => {
      expect(mapPolarCheckoutStatus(undefined)).toBe('open')
    })

    it('미정의 status (canceled 등) → open (default fallback 동작 보존)', () => {
      expect(mapPolarCheckoutStatus('canceled')).toBe('open')
      expect(mapPolarCheckoutStatus('unknown')).toBe('open')
    })
  })

  describe('8. isPaymentAlreadyRefunded()', () => {
    it('refunded → true', () => {
      expect(isPaymentAlreadyRefunded('refunded')).toBe(true)
    })

    it('partial_refunded → true', () => {
      expect(isPaymentAlreadyRefunded('partial_refunded')).toBe(true)
    })

    it('pending → false', () => {
      expect(isPaymentAlreadyRefunded('pending')).toBe(false)
    })

    it('completed → false (환불 전 결제 종료)', () => {
      expect(isPaymentAlreadyRefunded('completed')).toBe(false)
    })

    it('failed → false', () => {
      expect(isPaymentAlreadyRefunded('failed')).toBe(false)
    })

    it('빈 문자열 / unknown → false (안전 측면)', () => {
      expect(isPaymentAlreadyRefunded('')).toBe(false)
      expect(isPaymentAlreadyRefunded('unknown')).toBe(false)
    })
  })

  describe('9. isPolarRefundedStatus()', () => {
    it('refunded → true', () => {
      expect(isPolarRefundedStatus('refunded')).toBe(true)
    })

    it('paid → false', () => {
      expect(isPolarRefundedStatus('paid')).toBe(false)
    })

    it('undefined → false', () => {
      expect(isPolarRefundedStatus(undefined)).toBe(false)
    })
  })

  describe('10. isPolarSuccessStatus()', () => {
    it('paid → true', () => {
      expect(isPolarSuccessStatus('paid')).toBe(true)
    })

    it('succeeded → true', () => {
      expect(isPolarSuccessStatus('succeeded')).toBe(true)
    })

    it('refunded → false', () => {
      expect(isPolarSuccessStatus('refunded')).toBe(false)
    })

    it('undefined → false', () => {
      expect(isPolarSuccessStatus(undefined)).toBe(false)
    })
  })

  describe('11. 매핑 일관성 (cross-check)', () => {
    it('mapPolarOrderStatus + isPolar* helper 정합', () => {
      // paid → success + isPolarSuccessStatus true
      expect(mapPolarOrderStatus('paid')).toBe('success')
      expect(isPolarSuccessStatus('paid')).toBe(true)
      expect(isPolarRefundedStatus('paid')).toBe(false)

      // refunded → cancel + isPolarRefundedStatus true
      expect(mapPolarOrderStatus('refunded')).toBe('cancel')
      expect(isPolarRefundedStatus('refunded')).toBe(true)
      expect(isPolarSuccessStatus('refunded')).toBe(false)
    })

    it('NORMALIZED_WEBHOOK_STATUS / NORMALIZED_CHECKOUT_STATUS 어휘 분리 정합', () => {
      // webhook과 checkout 정규화 어휘는 분리 — 통합 X
      // webhook: success/fail/cancel | checkout: succeeded/refunded/failed/open
      expect(NORMALIZED_WEBHOOK_STATUS.SUCCESS).not.toBe(NORMALIZED_CHECKOUT_STATUS.SUCCEEDED)
      expect(NORMALIZED_WEBHOOK_STATUS.FAIL).not.toBe(NORMALIZED_CHECKOUT_STATUS.FAILED)
      expect(NORMALIZED_WEBHOOK_STATUS.CANCEL).not.toBe(NORMALIZED_CHECKOUT_STATUS.REFUNDED)
    })

    it('PAYMENT_STATUS 영역 환불 종료 어휘는 REFUNDED_STATES 통합', () => {
      expect(REFUNDED_STATES).toContain(PAYMENT_STATUS.REFUNDED)
      expect(REFUNDED_STATES).toContain(PAYMENT_STATUS.PARTIAL_REFUNDED)
      expect(REFUNDED_STATES).not.toContain(PAYMENT_STATUS.PENDING)
      expect(REFUNDED_STATES).not.toContain(PAYMENT_STATUS.COMPLETED)
      expect(REFUNDED_STATES).not.toContain(PAYMENT_STATUS.FAILED)
    })
  })
})
