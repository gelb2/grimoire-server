import { Injectable, Logger } from '@nestjs/common'
import { Polar } from '@polar-sh/sdk'
// 경로 캡슐화된 래퍼 — 테스트 시 이 모듈을 mock하면 됨
import { validateEvent, WebhookVerificationError } from './polar-webhooks'
import {
  PaymentGatewayPort,
  PaymentInitRequest,
  PaymentInitResponse,
  NormalizedWebhookEvent,
} from '@domain/port/outbound/payment-gateway.port'
import { CREDIT_PRODUCTS } from '@domain/model/config'

/**
 * Polar 결제 게이트웨이 어댑터 (MoR, Merchant of Record)
 *
 * - Checkout 생성: Polar SDK `checkouts.create()` → 호스티드 URL 반환
 * - 웹훅 검증: Standard Webhooks 스펙, `validateEvent` 유틸 사용
 *
 * 환경변수:
 * - POLAR_ACCESS_TOKEN: Organization Access Token
 * - POLAR_SERVER: 'sandbox' | 'production' (기본 'production')
 *   - 'production': polar.sh (KYC 전에는 "test mode"로 표시, Stripe 테스트 카드 가능)
 *   - 'sandbox': sandbox.polar.sh (완전 격리 환경, 별도 계정/토큰 필요)
 * - POLAR_WEBHOOK_SECRET: Webhook endpoint secret
 * - POLAR_PRODUCT_BASIC / POPULAR / BEST: Polar product UUID
 *
 * 내부 상품 ID(credit-5 등) → Polar product UUID 매핑은
 * CREDIT_PRODUCTS[i].providerProductIdEnv 환경변수로 처리.
 */
@Injectable()
export class PolarAdapter implements PaymentGatewayPort {
  private readonly logger = new Logger(PolarAdapter.name)
  private readonly polar: Polar
  private readonly webhookSecret: string

  constructor() {
    const accessToken = process.env.POLAR_ACCESS_TOKEN ?? ''
    const server = (process.env.POLAR_SERVER ?? 'production') as 'sandbox' | 'production'
    this.webhookSecret = process.env.POLAR_WEBHOOK_SECRET ?? ''

    this.polar = new Polar({
      accessToken,
      server,
    })

    if (!accessToken) {
      this.logger.warn('POLAR_ACCESS_TOKEN 미설정 — 결제 기능 비활성화')
    }
  }

  /**
   * 내부 상품 ID → Polar product UUID 매핑 (환경변수 기반).
   * 매핑 실패 시 null.
   */
  private resolvePolarProductId(internalProductId: string): string | null {
    const product = CREDIT_PRODUCTS.find((p) => p.id === internalProductId)
    if (!product) return null
    const polarId = process.env[product.providerProductIdEnv]
    return polarId || null
  }

  /** Checkout 세션 생성 */
  async initiatePayment(request: PaymentInitRequest): Promise<PaymentInitResponse> {
    const polarProductId = this.resolvePolarProductId(request.productId)
    if (!polarProductId) {
      throw new Error(
        `Polar product ID 매핑 실패: ${request.productId} — 환경변수를 확인하세요`,
      )
    }

    try {
      const checkout = await this.polar.checkouts.create({
        products: [polarProductId],
        successUrl: request.returnUrl,
        // Webhook에서 tradeNo ↔ 내부 Payment 매칭 + 작가 추적용
        metadata: {
          authorId: request.userId,
          internalProductId: request.productId,
        },
      })

      return {
        paymentUrl: checkout.url,
        tradeNo: checkout.id,
      }
    } catch (e: unknown) {
      this.logger.error(`Polar checkout 생성 실패: ${String(e)}`)
      const message = e instanceof Error ? e.message : '알 수 없는 오류'
      throw new Error(`Polar checkout 생성 실패: ${message}`)
    }
  }

  /**
   * Polar 웹훅 검증 + 정규화
   * - Standard Webhooks 서명 검증 (webhook-id / webhook-timestamp / webhook-signature)
   * - 처리 대상 이벤트: order.paid, order.refunded
   * - 그 외 이벤트는 null 반환 (무시)
   */
  verifyAndParseWebhook(
    rawBody: Buffer | string,
    headers: Record<string, string>,
  ): NormalizedWebhookEvent | null {
    if (!this.webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('POLAR_WEBHOOK_SECRET 미설정 — 프로덕션 웹훅 거부')
        return null
      }
      this.logger.warn('POLAR_WEBHOOK_SECRET 미설정 — 개발 환경에서 서명 검증 스킵')
    }

    // Standard Webhooks 서명 검증
    let event: ReturnType<typeof validateEvent>
    try {
      const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody)
      event = validateEvent(body, headers, this.webhookSecret)
    } catch (e) {
      if (e instanceof WebhookVerificationError) {
        this.logger.warn(`Polar 웹훅 서명 검증 실패: ${e.message}`)
        return null
      }
      this.logger.error(`Polar 웹훅 파싱 실패: ${String(e)}`)
      return null
    }

    // Polar SDK 타입은 camelCase(checkoutId, totalAmount 등) 사용.
    // 웹훅 페이로드 구조는 이벤트별로 다르지만 최소 공통 필드로만 접근.
    const data = event.data as unknown as {
      id?: string
      checkoutId?: string | null
      status?: string
      amount?: number
      netAmount?: number
      totalAmount?: number
      metadata?: Record<string, unknown>
    }

    // 이벤트 타입별 정규화
    switch (event.type) {
      case 'order.paid':
      case 'order.updated': {
        const tradeNo = data.checkoutId ?? data.id ?? ''
        return {
          type: event.type,
          tradeNo,
          amount: this.convertToKrw(data.totalAmount ?? data.netAmount ?? data.amount ?? 0),
          status: this.mapOrderStatus(data.status),
          userId: this.extractAuthorId(data.metadata),
        }
      }
      case 'order.refunded': {
        return {
          type: event.type,
          tradeNo: data.checkoutId ?? data.id ?? '',
          amount: this.convertToKrw(data.totalAmount ?? data.netAmount ?? data.amount ?? 0),
          status: 'cancel',
          userId: this.extractAuthorId(data.metadata),
        }
      }
      case 'checkout.updated': {
        // Checkout 상태 업데이트 — 완료/실패 시점 폴백
        if (data.status === 'succeeded') {
          return {
            type: event.type,
            tradeNo: data.id ?? '',
            amount: this.convertToKrw(data.totalAmount ?? 0),
            status: 'success',
            userId: this.extractAuthorId(data.metadata),
          }
        }
        if (data.status === 'failed' || data.status === 'expired') {
          return {
            type: event.type,
            tradeNo: data.id ?? '',
            amount: this.convertToKrw(data.totalAmount ?? 0),
            status: 'fail',
            userId: this.extractAuthorId(data.metadata),
          }
        }
        return null
      }
      default:
        // 그 외 이벤트는 무시 (구독 관련은 추후 확장)
        return null
    }
  }

  /** Polar metadata는 unknown 값 타입을 가짐 — string으로 안전 추출 */
  private extractAuthorId(metadata?: Record<string, unknown>): string | undefined {
    if (!metadata) return undefined
    const value = metadata['authorId']
    return typeof value === 'string' ? value : undefined
  }

  /** Polar order status → 정규화된 status */
  private mapOrderStatus(status?: string): 'success' | 'fail' | 'cancel' {
    switch (status) {
      case 'paid':
      case 'succeeded':
        return 'success'
      case 'refunded':
        return 'cancel'
      default:
        return 'fail'
    }
  }

  /**
   * Polar 금액(USD 센트)을 내부 원화(KRW) 기준으로 변환.
   * Polar 상품별 USD↔KRW 매핑은 CREDIT_PRODUCTS에 정의.
   * 웹훅 amount는 참고용이므로 고정 환율 적용 (결제 금액 검증은 Polar MoR이 담당).
   */
  private convertToKrw(amountCents: number): number {
    // 상품별 정확한 매핑 시도 (99센트 → 1000원 등)
    const product = CREDIT_PRODUCTS.find((p) => p.priceUsd === amountCents)
    if (product) return product.price
    // 매핑 실패 시 고정 환율 폴백 (1 USD = 1400 KRW)
    return Math.round((amountCents / 100) * 1400)
  }
}
