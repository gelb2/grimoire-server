import { Injectable, Inject, Logger, Optional } from '@nestjs/common'
import { MembershipPlanPort } from '@domain/port/outbound/membership-plan.port'
import { WebhookEventRepositoryPort } from '@domain/port/outbound/webhook-event-repository.port'
import { NormalizedSubscriptionEvent } from '@domain/port/outbound/payment-gateway.port'
import { PaymentNotificationUseCase } from '@application/payment/payment-notification.usecase'

/**
 * 크레딧 개편 CC-5 (2026-05-22, PAY-P1-4) — Polar 구독 생명주기 webhook 처리 usecase.
 *
 * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §7 / .claude/state/sprint-cc5-subscription-plan-draft.md §6
 *
 * ── 처리 흐름 ──
 *  - subscription.created / updated → `MembershipPlanPort.changeTier(authorId, tier)`
 *    + `polarSubscriptionId` 매핑 저장 (구독 가입 / 등급 변경)
 *  - subscription.canceled / revoked → `changeTier(authorId, 'free')` (free 다운그레이드)
 *
 * ── 멱등성 ──
 *  `payment.usecase` 와 동일 `WebhookEvent` 멱등성 게이트 재사용 — 동일 eventId 재수신 시 skip.
 *  `WebhookEvent.eventId @unique` + `createIfAbsent` P2002 race 차단.
 *
 * ── 원자성 ──
 *  `changeTier` 가 단일 `$transaction` 으로 MembershipPlan + Author.plan 미러를 원자 갱신.
 *
 * ── 정기결제 갱신 ↔ cron 정합 (plan-draft §8 案 A 분리) ──
 *  매월 정기결제 갱신(`order.paid` 재발행, tier 불변)은 본 usecase 가 아닌 충전 webhook 경로.
 *  풀 리셋은 `resetMonthlyPool` cron 단독 책임 — 구독 webhook 은 풀을 건드리지 않는다.
 *  본 usecase 는 등급 변경(가입/해지/등급 변경)만 처리 — `subscription.updated` 도 tier 변경 시만 changeTier.
 */
@Injectable()
export class ProcessSubscriptionWebhookUseCase {
  private readonly logger = new Logger(ProcessSubscriptionWebhookUseCase.name)

  constructor(
    @Inject('MembershipPlanPort') private readonly membershipRepo: MembershipPlanPort,
    @Inject('WebhookEventRepositoryPort')
    private readonly webhookEventRepo: WebhookEventRepositoryPort,
    /**
     * EMAIL-POLAR-READY Phase D (2026-05-27) — 구독 갱신 알림 호출점.
     * Optional — 미주입 시 알림 skip (회귀 보존). NullAdapter 시 호출 0.
     * $transaction 외부 + try/catch (changeTier commit 보존).
     */
    @Optional()
    private readonly notificationUseCase: PaymentNotificationUseCase | null = null,
  ) {}

  /**
   * 구독 webhook 처리 — 멱등성 게이트 → 등급 변경(changeTier).
   *
   * @param event 어댑터가 정규화한 구독 생명주기 이벤트
   * @returns 처리 결과 ({ processed, tier?, reason? })
   */
  async execute(event: NormalizedSubscriptionEvent): Promise<{
    processed: boolean
    tier?: string
    reason?: string
  }> {
    // 1차 게이트 — userId 누락 시 작가 매핑 불가, skip.
    if (!event.userId) {
      this.logger.warn(
        `구독 webhook userId 누락 (eventId=${event.eventId}, ${event.type}) — skip`,
      )
      await this.webhookEventRepo.createIfAbsent({
        eventId: event.eventId,
        source: 'polar',
        eventType: event.type,
        payload: event as unknown as object,
        status: 'skipped',
        errorMessage: 'missing_user_id',
      })
      return { processed: false, reason: 'missing_user_id' }
    }

    // 2차 게이트 — eventId 멱등성. 이미 처리된 이벤트는 즉시 skip (changeTier 0회).
    const existing = await this.webhookEventRepo.findByEventId(event.eventId)
    if (existing && existing.status === 'processed') {
      this.logger.warn(
        `중복 구독 webhook 감지 (eventId=${event.eventId}, status=processed) — skip`,
      )
      return { processed: false, reason: 'duplicate_event' }
    }

    // 등급 변경 — created/updated → 해당 tier / canceled·revoked → free 다운그레이드.
    // event.tier 는 어댑터가 이미 canceled/revoked 시 'free' 로 정규화함.
    try {
      await this.membershipRepo.changeTier(
        event.userId,
        event.tier,
        new Date(),
        event.polarSubscriptionId,
      )
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      this.logger.error(
        `구독 webhook changeTier 실패 (eventId=${event.eventId}, ${event.type}): ${message}`,
      )
      // 실패 박제 — Polar 재전송 시 재처리 가능 (status=failed).
      await this.webhookEventRepo.createIfAbsent({
        eventId: event.eventId,
        source: 'polar',
        eventType: event.type,
        payload: event as unknown as object,
        status: 'failed',
        errorMessage: message.slice(0, 500),
      })
      throw e
    }

    // 처리 성공 박제 — 멱등성 게이트 충족.
    await this.webhookEventRepo.createIfAbsent({
      eventId: event.eventId,
      source: 'polar',
      eventType: event.type,
      payload: event as unknown as object,
      status: 'processed',
    })

    this.logger.log(
      `구독 webhook 처리 완료 (eventId=${event.eventId}, ${event.lifecycle} → tier=${event.tier})`,
    )

    // EMAIL-POLAR-READY Phase D (2026-05-27) — 구독 갱신 알림 호출 (created/updated 시만).
    // $transaction 외부 + try/catch (changeTier commit 보존). NullAdapter 시 호출 0.
    if (this.notificationUseCase && (event.lifecycle === 'created' || event.lifecycle === 'updated')) {
      try {
        // membership 조회로 monthlyPoolPoints / expiresAt 매핑 (방금 changeTier한 결과)
        const plan = await this.membershipRepo.getPlan(event.userId)
        if (plan) {
          await this.notificationUseCase.notifySubscriptionRenewal({
            authorId: event.userId,
            tier: event.tier,
            monthlyPoolPoints: plan.monthlyPoolPoints,
            expiresAt: plan.expiresAt,
          })
        }
      } catch (e: unknown) {
        this.logger.warn(
          `구독 갱신 알림 실패 (eventId=${event.eventId}): ${
            e instanceof Error ? e.message : String(e)
          }`,
        )
      }
    }

    return { processed: true, tier: event.tier }
  }
}
