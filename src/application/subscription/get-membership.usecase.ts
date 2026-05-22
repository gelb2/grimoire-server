import { Injectable, Inject } from '@nestjs/common'
import { MembershipPlanPort } from '@domain/port/outbound/membership-plan.port'
import { resolveTierOrFree, MembershipTier } from '@domain/model/membership-tier'

/**
 * 크레딧 개편 CC-5 (2026-05-22, PAY-P1-4) — 멤버십 조회 usecase.
 *
 * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §7-2 #5 / sprint-cc5-subscription-plan-draft.md §7
 *
 * `MembershipPlanPort.getPlan` 을 HTTP(`GET /membership`)로 노출.
 * web 구독 페이지의 "현재 플랜" 배지가 의존(SUBSCRIPTION_AUDIT_WEB M-1 해소).
 *
 * ── lazy 안전망 (CC-3 정합) ──
 *  조회 직전 `checkAndResetExpiredPool` 호출 — `poolResetAt` 경과 시 즉시 리셋 후 응답.
 *  cron 실패 시에도 멤버십 조회 시점에 풀이 자동 보정됨.
 *
 * ── 보안 (SECURITY.md §4) ──
 *  내부 ID(`authorId`/`polarSubscriptionId`)는 본 usecase 가 반환하지 않는다 — DTO 매핑은 controller.
 */
@Injectable()
export class GetMembershipUseCase {
  constructor(
    @Inject('MembershipPlanPort') private readonly membershipRepo: MembershipPlanPort,
  ) {}

  /**
   * 작가 멤버십 조회.
   *
   * @param authorId 조회 작가 ID (JwtAuthGuard 검증된 본인)
   * @returns 등급 + 월 풀 + 리셋 시각 (내부 ID 미포함)
   */
  async execute(authorId: string): Promise<{
    tier: MembershipTier
    monthlyPoolPoints: number
    poolBalance: number
    poolResetAt: Date | null
    status: 'active' | 'expired' | 'cancelled'
    expiresAt: Date | null
  }> {
    // CC-3 lazy 안전망 — 조회 직전 만료 풀 자동 리셋 (cron 2차 백업).
    await this.membershipRepo.checkAndResetExpiredPool(authorId, new Date())

    const plan = await this.membershipRepo.getPlan(authorId)

    // 멤버십 미가입 작가 — free 폴백 응답 (resolveTierOrFree 정합).
    if (!plan) {
      return {
        tier: 'free',
        monthlyPoolPoints: 0,
        poolBalance: 0,
        poolResetAt: null,
        status: 'active',
        expiresAt: null,
      }
    }

    return {
      tier: resolveTierOrFree(plan),
      monthlyPoolPoints: plan.monthlyPoolPoints,
      poolBalance: plan.poolBalance,
      poolResetAt: plan.poolResetAt,
      status: plan.status,
      expiresAt: plan.expiresAt,
    }
  }
}
