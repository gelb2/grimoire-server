import { IsString, IsNotEmpty, IsIn, IsUrl } from 'class-validator'

/**
 * 크레딧 개편 CC-5 (2026-05-22, PAY-P1-4) — 구독 정기결제 HTTP DTO.
 *
 * 정본: .claude/shared-contracts.md §30 CreditOverhaul / docs/api-contract.md
 *
 * 보안 (SECURITY.md §4) — 응답 DTO 는 내부 ID(authorId/polarSubscriptionId) 미노출.
 */

/** POST /subscriptions/checkout 요청 body */
export class StartSubscriptionDto {
  /** 구독 등급 — free 는 구독 불가 (pro/premium 만) */
  @IsString()
  @IsIn(['pro', 'premium'], { message: '구독 등급은 pro 또는 premium 이어야 합니다' })
  tier!: 'pro' | 'premium'

  /** 결제 완료 후 리다이렉트할 웹 URL */
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false }, { message: '유효한 returnUrl 이 필요합니다' })
  returnUrl!: string
}

/** POST /subscriptions/checkout 응답 — 호스티드 Checkout URL */
export class SubscriptionCheckoutResponseDto {
  /** Polar 호스티드 Checkout URL (정기결제 모드) */
  paymentUrl!: string
  /** 외부 거래 ID (Polar checkout ID) */
  tradeNo!: string
}

/**
 * GET /membership 응답 — 멤버십 등급 + 월 풀 상태.
 * 내부 ID(authorId/polarSubscriptionId) 미노출 (SECURITY.md §4).
 */
export class MembershipResponseDto {
  /** 등급 — free | pro | premium */
  tier!: 'free' | 'pro' | 'premium'
  /** 월 포인트 풀 크기 (free 0 / pro 93,000 / premium 191,500) */
  monthlyPoolPoints!: number
  /** 현재 잔여 풀 */
  poolBalance!: number
  /** 다음 풀 리셋 시각 (ISO 문자열, free 는 null) */
  poolResetAt!: string | null
  /** 멤버십 상태 — active | expired | cancelled */
  status!: 'active' | 'expired' | 'cancelled'
  /** 구독 만료 시각 (ISO 문자열, free 는 null) */
  expiresAt!: string | null
}

/** GetMembershipUseCase 반환값 → GET /membership 응답 DTO */
export function toMembershipResponse(plan: {
  tier: 'free' | 'pro' | 'premium'
  monthlyPoolPoints: number
  poolBalance: number
  poolResetAt: Date | null
  status: 'active' | 'expired' | 'cancelled'
  expiresAt: Date | null
}): MembershipResponseDto {
  return {
    tier: plan.tier,
    monthlyPoolPoints: plan.monthlyPoolPoints,
    poolBalance: plan.poolBalance,
    poolResetAt: plan.poolResetAt ? plan.poolResetAt.toISOString() : null,
    status: plan.status,
    expiresAt: plan.expiresAt ? plan.expiresAt.toISOString() : null,
  }
}
