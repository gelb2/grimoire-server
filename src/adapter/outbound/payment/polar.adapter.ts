import { Injectable, Logger, Optional, Inject } from '@nestjs/common'
import { Polar } from '@polar-sh/sdk'
// 경로 캡슐화된 래퍼 — 테스트 시 이 모듈을 mock하면 됨
import { validateEvent, WebhookVerificationError } from './polar-webhooks'
import {
  PaymentGatewayPort,
  PaymentInitRequest,
  PaymentInitResponse,
  NormalizedWebhookEvent,
  NormalizedSubscriptionEvent,
  NormalizedCheckout,
  PolarErrorClass,
  PolarErrorClassification,
} from '@domain/port/outbound/payment-gateway.port'
import { CircuitBreakerPort } from '@domain/port/outbound/circuit-breaker.port'
import { CREDIT_PRODUCTS } from '@domain/model/config'
import { WebhookVerificationFailedError } from '@domain/model/webhook-verification-error'
// PAY-P3-D Status enum mapping (도메인 매핑 함수 영역 정합 — shared-contracts §28 / ADR-010)
import {
  mapPolarOrderStatus,
  mapPolarCheckoutStatus,
} from '@domain/model/payment-status'
import { isProduction } from '@infrastructure/config/app-env'

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
  /**
   * PAY-P3-B 구멍-C 차단: SDK 호출 timeout (워커 자원 leak 차단).
   * 정본: shared-contracts §24 PolarSDKTimeoutPolicy.
   * 기본값 30000ms, env `POLAR_SDK_TIMEOUT_MS` 오버라이드.
   */
  private readonly timeoutMs: number

  /**
   * PAY-P3-H 차단: Polar SDK 호출 경계 Circuit Breaker (가용성 차단).
   * 정본: shared-contracts §27 CircuitBreakerPolicy, ADR-009.
   * 3 호출점 적용: polar:checkouts:create / polar:checkouts:list / polar:checkouts:get.
   * AuditLog Optional — Optional 주입 시 4 action 박제 (open / close / half_open_trial / reject).
   */
  constructor(
    @Optional() @Inject('CircuitBreakerPort') private readonly circuitBreaker?: CircuitBreakerPort,
  ) {
    const accessToken = process.env.POLAR_ACCESS_TOKEN ?? ''
    const server = (process.env.POLAR_SERVER ?? 'production') as 'sandbox' | 'production'
    this.webhookSecret = process.env.POLAR_WEBHOOK_SECRET ?? ''

    // PAY-P3-B: 옵션 A 채택 — Polar SDK v0.47.0 SDKOptions.timeoutMs 내장 옵션 사용 (config.d.ts L38 검증).
    // env POLAR_SDK_TIMEOUT_MS 미설정 시 기본 30s. parseInt 실패 시(NaN) 30s fallback.
    const parsed = parseInt(process.env.POLAR_SDK_TIMEOUT_MS ?? '', 10)
    this.timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 30000

    this.polar = new Polar({
      accessToken,
      server,
      timeoutMs: this.timeoutMs,
    })

    if (!accessToken) {
      this.logger.warn('POLAR_ACCESS_TOKEN 미설정 — 결제 기능 비활성화')
    }
  }

  /**
   * PAY-P3-B 구멍-C 차단: Polar SDK exception 5분류.
   * 정본: shared-contracts §24 PolarSDKTimeoutPolicy.
   *
   * 분류 매트릭스:
   * - timeout: AbortError, TimeoutError, RequestTimeoutError, RequestAbortedError, message에 'timeout' 포함
   * - network: ECONNRESET, ENOTFOUND, ETIMEDOUT, EPIPE, ECONNREFUSED, ConnectionError
   * - server_5xx: HTTP 500/502/503/504 등 (PolarError.statusCode 추출)
   * - client_4xx: HTTP 400/401/403/404/422 등 (retry 무의미 → permanent_failed)
   * - unknown: 분류 실패 시 안전 fallback (retry 가능 영역)
   *
   * Duck typing 사용 — SDK 내부 import 의존 최소화 (SDK 버전 업그레이드 회귀 차단).
   */
  classifyPolarError(e: unknown): PolarErrorClassification {
    const message = e instanceof Error ? e.message : String(e)
    const errorName = e instanceof Error ? e.name : ''

    // 1. AbortError / TimeoutError / Polar SDK RequestTimeoutError·RequestAbortedError → timeout 분류
    if (
      errorName === 'AbortError' ||
      errorName === 'TimeoutError' ||
      errorName === 'RequestTimeoutError' ||
      errorName === 'RequestAbortedError' ||
      /\btimeout\b/i.test(message) ||
      /\baborted?\b/i.test(message)
    ) {
      return { errorClass: 'timeout', message }
    }

    // 2. Network 에러 (Node.js system errors + Polar SDK ConnectionError)
    if (
      errorName === 'ConnectionError' ||
      /^(ECONNRESET|ENOTFOUND|ETIMEDOUT|EPIPE|ECONNREFUSED)/.test(message) ||
      /\b(ECONNRESET|ENOTFOUND|ETIMEDOUT|EPIPE|ECONNREFUSED)\b/.test(message)
    ) {
      return { errorClass: 'network', message }
    }

    // 3. HTTP 응답 분류 — Polar SDK PolarError 또는 fetch Response status 추출 (duck typing)
    const httpStatus = this.extractHttpStatus(e)
    if (httpStatus !== undefined) {
      if (httpStatus >= 500 && httpStatus < 600) {
        return { errorClass: 'server_5xx', httpStatus, message }
      }
      if (httpStatus >= 400 && httpStatus < 500) {
        return { errorClass: 'client_4xx', httpStatus, message }
      }
    }

    // 4. 기타 (unknown — 안전 측면 fallback, retry 가능 영역)
    return { errorClass: 'unknown', message }
  }

  /**
   * Polar SDK 에러 객체에서 HTTP status 추출 (duck typing).
   * SDK 버전별 형식 호환:
   * - PolarError.statusCode (Polar SDK v0.47.0+ 정본)
   * - error.response?.status (legacy fetch 패턴)
   * - error.status (axios-like 패턴)
   */
  private extractHttpStatus(e: unknown): number | undefined {
    if (typeof e !== 'object' || e === null) return undefined
    const err = e as {
      statusCode?: unknown
      response?: { status?: unknown }
      status?: unknown
    }
    const candidates = [err.statusCode, err.response?.status, err.status]
    for (const c of candidates) {
      if (typeof c === 'number' && Number.isFinite(c) && c >= 100 && c < 600) {
        return c
      }
    }
    return undefined
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

  /**
   * CC-5 (PAY-P1-4) — 구독 등급 → Polar 구독 product UUID 매핑 (graceful §4).
   *
   * env `POLAR_PRODUCT_SUBSCRIPTION_PRO` / `_PREMIUM` 기반. `resolvePolarProductId` 패턴 차용.
   * env 미설정 시 null → 호출자가 503 graceful 분기 (구독 checkout 만 비활성, 나머지 정상).
   */
  private resolveSubscriptionProductId(tier: 'pro' | 'premium'): string | null {
    const envKey = `POLAR_PRODUCT_SUBSCRIPTION_${tier.toUpperCase()}`
    const polarId = process.env[envKey]
    return polarId || null
  }

  /**
   * CC-5 (PAY-P1-4) — Polar 구독 product UUID → 내부 등급 역매핑.
   *
   * `resolveSubscriptionProductId` 의 역(逆). 구독 webhook 에서 `data.productId` 로 등급 판정.
   * env 미설정/미매칭 시 null → 호출자가 metadata.tier 폴백.
   */
  private tierForSubscriptionProductId(
    polarProductId: string | undefined,
  ): 'pro' | 'premium' | null {
    if (!polarProductId) return null
    if (polarProductId === process.env['POLAR_PRODUCT_SUBSCRIPTION_PRO']) return 'pro'
    if (polarProductId === process.env['POLAR_PRODUCT_SUBSCRIPTION_PREMIUM']) return 'premium'
    return null
  }

  /** Checkout 세션 생성 */
  async initiatePayment(request: PaymentInitRequest): Promise<PaymentInitResponse> {
    const polarProductId = this.resolvePolarProductId(request.productId)
    if (!polarProductId) {
      throw new Error(
        `Polar product ID 매핑 실패: ${request.productId} — 환경변수를 확인하세요`,
      )
    }

    // PAY-P3-H: Circuit Breaker 래핑 (가용성 차단, Hystrix 3 상태 머신 정합).
    // OPEN 상태 시 SDK 호출 0건 + CircuitOpenError throw (호출자 영역 분기).
    // 정본: shared-contracts §27 CircuitBreakerPolicy.
    const invokeSDK = async (): Promise<PaymentInitResponse> => {
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
        // PAY-P3-B 구멍-C 차단: SDK exception 분류 + 로깅
        // 정본: shared-contracts §24 PolarSDKTimeoutPolicy
        const polarError = this.classifyPolarError(e)
        const httpStatusLabel = polarError.httpStatus ?? 'N/A'
        this.logger.error(
          `[PolarSDK] initiatePayment ${polarError.errorClass} httpStatus=${httpStatusLabel} message="${polarError.message.slice(0, 200)}"`,
        )
        // PAY-P3-H: client_4xx는 CircuitBreaker failureCount 영향 0 강제 (요청 결함, SDK/Polar 장애 0).
        // 4xx 분류 시 throw 그대로 (CircuitBreaker가 외 분류만 누적).
        if (polarError.errorClass === 'client_4xx') {
          throw new Error(`Polar checkout 생성 실패: ${polarError.message}`)
        }
        // timeout / network / server_5xx / unknown 분류 → CircuitBreaker가 failureCount++
        throw e
      }
    }

    // CircuitBreaker 미주입 시 (회귀 보존) — 직접 호출.
    // 본 sprint = app.module 의무 주입 정합 (운영 영역 미주입 0건).
    if (!this.circuitBreaker) {
      try {
        return await invokeSDK()
      } catch (e: unknown) {
        if (e instanceof Error && e.message.startsWith('Polar checkout 생성 실패')) throw e
        const polarError = this.classifyPolarError(e)
        throw new Error(`Polar checkout 생성 실패: ${polarError.message}`)
      }
    }

    try {
      return await this.circuitBreaker.execute('polar:checkouts:create', invokeSDK)
    } catch (e: unknown) {
      // CircuitOpenError는 호출자(payment.usecase)가 분기 처리 — 본 adapter는 그대로 throw.
      // 외 분류는 분류 후 사용자 친화 메시지 박제.
      if (e instanceof Error && e.name === 'CircuitOpenError') throw e
      if (e instanceof Error && e.message.startsWith('Polar checkout 생성 실패')) throw e
      const polarError = this.classifyPolarError(e)
      throw new Error(`Polar checkout 생성 실패: ${polarError.message}`)
    }
  }

  /**
   * CC-5 (PAY-P1-4) — Polar 구독 정기결제 Checkout 세션 생성 (graceful §4).
   *
   * recurring product 를 전달하면 Polar 가 정기결제 모드로 자동 처리.
   * env(`POLAR_PRODUCT_SUBSCRIPTION_{tier}`) 미설정 시 **null 반환** — 호출자(usecase)가 503 분기.
   * env 설정 시 `initiatePayment` 와 동일 CircuitBreaker 래핑 + metadata(authorId/tier) 박제.
   */
  async initiateSubscriptionCheckout(
    tier: 'pro' | 'premium',
    userId: string,
    returnUrl: string,
  ): Promise<PaymentInitResponse | null> {
    const polarProductId = this.resolveSubscriptionProductId(tier)
    // graceful §4 — env 미설정 시 null (구독 checkout 만 비활성, 나머지 정상).
    if (!polarProductId) {
      this.logger.warn(
        `구독 product env 미설정 (POLAR_PRODUCT_SUBSCRIPTION_${tier.toUpperCase()}) — 구독 checkout 비활성`,
      )
      return null
    }

    const invokeSDK = async (): Promise<PaymentInitResponse> => {
      try {
        const checkout = await this.polar.checkouts.create({
          products: [polarProductId],
          successUrl: returnUrl,
          // 구독 webhook 에서 authorId ↔ MembershipPlan 매칭 + 등급 추적용
          metadata: {
            authorId: userId,
            subscriptionTier: tier,
          },
        })
        return { paymentUrl: checkout.url, tradeNo: checkout.id }
      } catch (e: unknown) {
        const polarError = this.classifyPolarError(e)
        const httpStatusLabel = polarError.httpStatus ?? 'N/A'
        this.logger.error(
          `[PolarSDK] initiateSubscriptionCheckout ${polarError.errorClass} httpStatus=${httpStatusLabel} message="${polarError.message.slice(0, 200)}"`,
        )
        if (polarError.errorClass === 'client_4xx') {
          throw new Error(`Polar 구독 checkout 생성 실패: ${polarError.message}`)
        }
        throw e
      }
    }

    // initiatePayment 와 동일 CircuitBreaker 호출점 재사용 (polar:checkouts:create).
    if (!this.circuitBreaker) {
      try {
        return await invokeSDK()
      } catch (e: unknown) {
        if (e instanceof Error && e.message.startsWith('Polar 구독 checkout 생성 실패')) throw e
        const polarError = this.classifyPolarError(e)
        throw new Error(`Polar 구독 checkout 생성 실패: ${polarError.message}`)
      }
    }
    try {
      return await this.circuitBreaker.execute('polar:checkouts:create', invokeSDK)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'CircuitOpenError') throw e
      if (e instanceof Error && e.message.startsWith('Polar 구독 checkout 생성 실패')) throw e
      const polarError = this.classifyPolarError(e)
      throw new Error(`Polar 구독 checkout 생성 실패: ${polarError.message}`)
    }
  }

  /**
   * Polar 웹훅 검증 + 정규화
   * - Standard Webhooks 서명 검증 (webhook-id / webhook-timestamp / webhook-signature)
   * - 처리 대상 이벤트: order.paid, order.refunded, checkout.updated
   * - CC-5 (PAY-P1-4): subscription.created/updated/canceled/revoked 4 이벤트
   * - 그 외 이벤트는 null 반환 (무시)
   * - eventId 박제 (Sprint PAY-P0-1): `webhook-id` 헤더 추출, 누락 시 null 반환 (멱등성 보장 불가 → 안전 거부)
   */
  verifyAndParseWebhook(
    rawBody: Buffer | string,
    headers: Record<string, string>,
  ): NormalizedWebhookEvent | NormalizedSubscriptionEvent | null {
    // F-13 — 무효(서명검증 실패/파싱 불가/eventId 누락)는 WebhookVerificationFailedError 로 throw
    // (컨트롤러가 400 매핑 → Polar 가 실패로 인지, silent 201 ack 마스킹 제거). 정상이나 미처리
    // 대상 이벤트(알 수 없는 type 등)만 null 반환(무시). R1/R2/R1-notify 처리 로직은 미접촉.
    if (!this.webhookSecret) {
      if (isProduction()) {
        // F-12 로 부팅 차단되나 방어 — prod 시크릿 부재 = 검증 불가 → 4xx surface.
        this.logger.error('POLAR_WEBHOOK_SECRET 미설정 — 프로덕션 웹훅 거부')
        throw new WebhookVerificationFailedError('webhook_secret_missing')
      }
      this.logger.warn('POLAR_WEBHOOK_SECRET 미설정 — dev 환경에서 서명 검증 스킵')
    }

    // Standard Webhooks 서명 검증
    let event: ReturnType<typeof validateEvent>
    try {
      const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody)
      event = validateEvent(body, headers, this.webhookSecret)
    } catch (e) {
      if (e instanceof WebhookVerificationError) {
        this.logger.warn(`Polar 웹훅 서명 검증 실패: ${e.message}`)
        throw new WebhookVerificationFailedError(`signature_verification_failed: ${e.message}`)
      }
      this.logger.error(`Polar 웹훅 파싱 실패: ${String(e)}`)
      throw new WebhookVerificationFailedError('payload_parse_failed')
    }

    // Standard Webhooks 스펙: `webhook-id` (소문자) 헤더가 PG 발급 unique 식별자.
    // 일부 프록시는 헤더명을 정규화하므로 대소문자 fallback 모두 시도.
    const eventId = this.extractWebhookId(headers)
    if (!eventId) {
      // eventId 누락 시 멱등성 게이트가 동작 못함 → 안전 거부 (Polar는 재전송 시 다른 webhook-id 사용 가능).
      this.logger.warn('Polar 웹훅 webhook-id 헤더 누락 — 멱등성 보장 불가, 거부')
      throw new WebhookVerificationFailedError('webhook_id_missing')
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
      // CC-5 — 구독 webhook: product 역매핑(productId) + 구독 상태(status)
      productId?: string
      metadata?: Record<string, unknown>
    }

    // 이벤트 타입별 정규화
    switch (event.type) {
      case 'order.paid':
      case 'order.updated': {
        const tradeNo = data.checkoutId ?? data.id ?? ''
        return {
          eventId,
          type: event.type,
          tradeNo,
          amount: this.convertToKrw(data.totalAmount ?? data.netAmount ?? data.amount ?? 0),
          status: this.mapOrderStatus(data.status),
          userId: this.extractAuthorId(data.metadata),
        }
      }
      case 'order.refunded': {
        return {
          eventId,
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
            eventId,
            type: event.type,
            tradeNo: data.id ?? '',
            amount: this.convertToKrw(data.totalAmount ?? 0),
            status: 'success',
            userId: this.extractAuthorId(data.metadata),
          }
        }
        if (data.status === 'failed' || data.status === 'expired') {
          return {
            eventId,
            type: event.type,
            tradeNo: data.id ?? '',
            amount: this.convertToKrw(data.totalAmount ?? 0),
            status: 'fail',
            userId: this.extractAuthorId(data.metadata),
          }
        }
        return null
      }
      // CC-5 (PAY-P1-4) — 구독 생명주기 4 이벤트.
      case 'subscription.created':
        return this.parseSubscriptionEvent(eventId, event.type, 'created', data)
      case 'subscription.updated':
        return this.parseSubscriptionEvent(eventId, event.type, 'updated', data)
      case 'subscription.canceled':
        return this.parseSubscriptionEvent(eventId, event.type, 'canceled', data)
      case 'subscription.revoked':
        return this.parseSubscriptionEvent(eventId, event.type, 'revoked', data)
      default:
        // 그 외 이벤트는 무시 (benefit.* / customer.* 등 미지원)
        return null
    }
  }

  /**
   * CC-5 (PAY-P1-4) — Polar 구독 webhook payload → NormalizedSubscriptionEvent 정규화.
   *
   * 등급 결정 — `data.productId` 역매핑 우선, 미매칭 시 `metadata.subscriptionTier` 폴백.
   * canceled/revoked 는 등급 무관 'free' 다운그레이드 → tier='free' 고정.
   * `polarSubscriptionId`(data.id) 누락 시 null 반환 (매핑 불가 → 안전 거부).
   */
  private parseSubscriptionEvent(
    eventId: string,
    type: string,
    lifecycle: 'created' | 'updated' | 'canceled' | 'revoked',
    data: { id?: string; productId?: string; metadata?: Record<string, unknown> },
  ): NormalizedSubscriptionEvent | null {
    const polarSubscriptionId = data.id
    if (!polarSubscriptionId) {
      this.logger.warn(`구독 webhook data.id 누락 (${type}) — MembershipPlan 매핑 불가, 거부`)
      return null
    }

    // canceled/revoked = free 다운그레이드 (등급 무관).
    let tier: 'free' | 'pro' | 'premium' = 'free'
    if (lifecycle === 'created' || lifecycle === 'updated') {
      // productId 역매핑 우선 → metadata.subscriptionTier 폴백.
      const mapped = this.tierForSubscriptionProductId(data.productId)
      tier = mapped ?? this.extractSubscriptionTier(data.metadata) ?? 'free'
    }

    return {
      eventId,
      type,
      lifecycle,
      polarSubscriptionId,
      tier,
      userId: this.extractAuthorId(data.metadata),
    }
  }

  /** 구독 metadata 에서 subscriptionTier 안전 추출 (productId 역매핑 폴백). */
  private extractSubscriptionTier(
    metadata?: Record<string, unknown>,
  ): 'pro' | 'premium' | null {
    if (!metadata) return null
    const value = metadata['subscriptionTier']
    if (value === 'pro' || value === 'premium') return value
    return null
  }

  /**
   * `webhook-id` 헤더 추출 — Standard Webhooks 스펙은 소문자가 정본이지만,
   * 일부 프록시 (Express raw 등)가 대소문자를 보존하므로 fallback 시도.
   */
  private extractWebhookId(headers: Record<string, string>): string | null {
    const raw =
      headers['webhook-id'] ??
      headers['Webhook-Id'] ??
      headers['WEBHOOK-ID'] ??
      null
    if (!raw || typeof raw !== 'string' || raw.trim() === '') return null
    return raw
  }

  /** Polar metadata는 unknown 값 타입을 가짐 — string으로 안전 추출 */
  private extractAuthorId(metadata?: Record<string, unknown>): string | undefined {
    if (!metadata) return undefined
    const value = metadata['authorId']
    return typeof value === 'string' ? value : undefined
  }

  /**
   * Polar order status → 정규화된 status.
   * PAY-P3-D 영역 도메인 매핑 함수 영역 위임 (정본: shared-contracts §28).
   * 호출자 패턴 보존 (private 메서드 영역 유지 — 호출 영역 변경 0건).
   */
  private mapOrderStatus(status?: string): 'success' | 'fail' | 'cancel' {
    return mapPolarOrderStatus(status)
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

  /**
   * PG↔DB 정합성 검증 cron용 — 최근 checkout 목록 조회 (Sprint PAY-P0-2).
   *
   * - Polar SDK `polar.checkouts.list({ page, limit, sorting: ['-created_at'] })` 활용.
   * - Polar는 server-side `since` 필터 미지원 → clientSide 필터링 필수.
   * - 정렬: created_at desc → since 이전 checkout 도달 시 break (이후 페이지 스킵).
   * - limit은 최대 100 (Polar SDK 제약).
   *
   * @param since createdAt 이후 checkout만 반환
   * @param limit 페이지당 row 수 (최대 100)
   * @returns NormalizedCheckout 배열 (시간순)
   */
  async listRecentCheckouts(since: Date, limit: number): Promise<NormalizedCheckout[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100)
    const collected: NormalizedCheckout[] = []
    let page = 1
    const MAX_PAGES = 20 // 안전 상한 — page 20 * limit 100 = 최대 2000 row/cron

    // PAY-P3-H: Circuit Breaker 래핑 (listRecentCheckouts = polar:checkouts:list 호출점).
    // 호출점 분리 — initiatePayment(create)와 독립 상태 (한 호출점 OPEN 시 다른 호출점 영향 0).
    // 정본: shared-contracts §27 CircuitBreakerPolicy.
    const invokePage = async (currentPage: number): Promise<{
      result?: { items?: Array<Record<string, unknown>> }
    }> => {
      const response = await this.polar.checkouts.list({
        page: currentPage,
        limit: safeLimit,
        sorting: ['-created_at'],
      })
      return response as unknown as { result?: { items?: Array<Record<string, unknown>> } }
    }

    try {
      while (page <= MAX_PAGES) {
        const response = this.circuitBreaker
          ? await this.circuitBreaker.execute('polar:checkouts:list', () => invokePage(page))
          : await invokePage(page)
        // Polar SDK는 PageIterator 반환 — result.items 배열 직접 접근
        const result = response.result
        const items = result?.items ?? []
        if (items.length === 0) break

        let reachedSince = false
        for (const raw of items) {
          const checkout = raw as {
            id?: string
            createdAt?: Date | string
            status?: string
            totalAmount?: number
            netAmount?: number
            amount?: number
          }
          const createdAt = checkout.createdAt
            ? new Date(checkout.createdAt)
            : new Date(0)
          if (createdAt < since) {
            // since 이전 checkout 도달 → 더 이상 페이지 진행 불필요
            reachedSince = true
            break
          }
          if (!checkout.id) continue
          collected.push({
            externalTransactionId: checkout.id,
            status: this.mapCheckoutStatus(checkout.status),
            amount: this.convertToKrw(
              checkout.totalAmount ?? checkout.netAmount ?? checkout.amount ?? 0,
            ),
            createdAt,
          })
        }

        if (reachedSince) break
        if (items.length < safeLimit) break // 마지막 페이지
        page += 1
      }
    } catch (e: unknown) {
      // PAY-P3-H: CircuitOpenError 호출자(payment-reconciliation.job) 영역 분기 — 그대로 throw.
      if (e instanceof Error && e.name === 'CircuitOpenError') {
        this.logger.warn(
          `[CircuitBreaker] listRecentCheckouts skip — polar:checkouts:list OPEN (page=${page})`,
        )
        throw e
      }
      // PAY-P3-B 구멍-C 차단: SDK exception 분류 + 로깅 (Reconciliation 정합)
      // 정본: shared-contracts §24 PolarSDKTimeoutPolicy
      const polarError = this.classifyPolarError(e)
      const httpStatusLabel = polarError.httpStatus ?? 'N/A'
      this.logger.error(
        `[PolarSDK] listRecentCheckouts ${polarError.errorClass} httpStatus=${httpStatusLabel} page=${page} message="${polarError.message.slice(0, 200)}"`,
      )
      throw new Error(`Polar checkouts.list 호출 실패: ${polarError.message}`)
    }

    return collected
  }

  /**
   * Polar checkout status → NormalizedCheckout status 매핑.
   * - 'succeeded' → 'succeeded' (S1 boost 후보)
   * - 'expired' / 'failed' → 'failed'
   * - 'open' → 'open' (사용자 결제 진행 중)
   * - 'confirmed' → 'open' (결제 확인 단계 — 아직 webhook 미발송 가능)
   * - refund는 checkout 단계 status가 아닌 order 단계 — list API에서는 확인 불가 (S2 mismatch는 webhook 의존)
   */
  private mapCheckoutStatus(
    status?: string,
  ): 'succeeded' | 'refunded' | 'failed' | 'open' {
    // PAY-P3-D 영역 도메인 매핑 함수 영역 위임 (정본: shared-contracts §28).
    // 기존 default → 'open' 동작 보존 (reconciliation false positive 차단).
    return mapPolarCheckoutStatus(status)
  }
}
