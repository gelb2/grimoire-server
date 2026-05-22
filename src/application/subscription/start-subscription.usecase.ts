import {
  Injectable,
  Inject,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common'
import { PaymentGatewayPort } from '@domain/port/outbound/payment-gateway.port'
import { isMembershipTier } from '@domain/model/membership-tier'

/**
 * 크레딧 개편 CC-5 (2026-05-22, PAY-P1-4) — 구독 정기결제 시작 usecase.
 *
 * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §7-2 #4 / sprint-cc5-subscription-plan-draft.md §7
 *
 * 작가가 Pro/Premium 구독을 시작 → Polar 호스티드 Checkout(정기결제 모드) URL 반환.
 * 결제 완료 시 Polar 가 `subscription.created` webhook 발행 → ProcessSubscriptionWebhookUseCase.
 *
 * ── graceful 설계 (plan-draft §4) ──
 *  env(`POLAR_PRODUCT_SUBSCRIPTION_{tier}`) 미설정 시 어댑터가 null 반환 →
 *  본 usecase 가 `ServiceUnavailableException`(503) throw — 명확한 한국어 메시지.
 *  구독 checkout 만 비활성, webhook 수신·멤버십 조회·기존 충전·테마·분석은 전부 정상.
 */
@Injectable()
export class StartSubscriptionUseCase {
  private readonly logger = new Logger(StartSubscriptionUseCase.name)

  constructor(
    @Inject('PaymentGatewayPort') private readonly paymentGateway: PaymentGatewayPort,
  ) {}

  /**
   * 구독 Checkout 시작.
   *
   * @param authorId 구독 작가 ID (JwtAuthGuard 검증된 본인)
   * @param tier 구독 등급 ('pro' | 'premium' — free 는 구독 대상 아님)
   * @param returnUrl 결제 완료 후 리다이렉트 웹 URL
   * @returns 호스티드 Checkout URL + tradeNo
   */
  async execute(
    authorId: string,
    tier: string,
    returnUrl: string,
  ): Promise<{ paymentUrl: string; tradeNo: string }> {
    // tier 검증 — free 는 구독 불가, 유효 등급은 pro/premium 만.
    if (!isMembershipTier(tier) || tier === 'free') {
      throw new BadRequestException('구독 등급은 pro 또는 premium 이어야 합니다')
    }
    if (!returnUrl || typeof returnUrl !== 'string') {
      throw new BadRequestException('returnUrl 이 필요합니다')
    }

    // graceful §4 — adapter 가 initiateSubscriptionCheckout 미구현 시 503.
    if (!this.paymentGateway.initiateSubscriptionCheckout) {
      throw new ServiceUnavailableException(
        '구독 결제가 아직 활성화되지 않았습니다. 잠시 후 다시 시도해 주세요.',
      )
    }

    const result = await this.paymentGateway.initiateSubscriptionCheckout(
      tier,
      authorId,
      returnUrl,
    )

    // graceful §4 — env(POLAR_PRODUCT_SUBSCRIPTION_*) 미설정 시 null → 503.
    if (!result) {
      this.logger.warn(
        `구독 checkout 요청 실패 (authorId=${authorId}, tier=${tier}) — env 미설정`,
      )
      throw new ServiceUnavailableException(
        '구독 결제가 아직 활성화되지 않았습니다. 잠시 후 다시 시도해 주세요.',
      )
    }

    return result
  }
}
