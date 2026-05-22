import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { StartSubscriptionUseCase } from '@application/subscription/start-subscription.usecase'
import { GetMembershipUseCase } from '@application/subscription/get-membership.usecase'
import {
  StartSubscriptionDto,
  SubscriptionCheckoutResponseDto,
  MembershipResponseDto,
  toMembershipResponse,
} from '@adapter/inbound/http/dto/subscription.dto'

/**
 * 크레딧 개편 CC-5 (2026-05-22, PAY-P1-4) — 구독 정기결제 컨트롤러.
 *
 * 정본: docs/api-contract.md / .claude/shared-contracts.md §30 / SECURITY.md §4
 *
 * - POST /subscriptions/checkout — Polar 정기결제 Checkout 시작 (JwtAuthGuard + Throttle).
 *   graceful §4 — env(POLAR_PRODUCT_SUBSCRIPTION_*) 미설정 시 usecase 가 503 throw.
 * - GET /membership — 멤버십 등급/풀 조회 (JwtAuthGuard). 내부 ID 미노출.
 */
@Controller()
export class SubscriptionController {
  constructor(
    private readonly startSubscriptionUseCase: StartSubscriptionUseCase,
    private readonly getMembershipUseCase: GetMembershipUseCase,
  ) {}

  /**
   * 구독 정기결제 시작 (인증 필요).
   * 결제 시작 = payment.controller initiate 와 동일 분당 3회 Throttle.
   * env 미설정 시 503 (graceful §4).
   */
  @Throttle({ default: { ttl: 60000, limit: 3 } }) // 분당 3회
  @UseGuards(JwtAuthGuard)
  @Post('subscriptions/checkout')
  async checkout(
    @Req() req: AuthenticatedRequest,
    @Body() body: StartSubscriptionDto,
  ): Promise<SubscriptionCheckoutResponseDto> {
    // 소유권 — 본인(req.user.sub) 구독만 시작 (body 에 authorId 미수신 — 위조 불가).
    return this.startSubscriptionUseCase.execute(req.user.sub, body.tier, body.returnUrl)
  }

  /** 멤버십 등급/풀 조회 (인증 필요) — 본인 멤버십만. */
  @UseGuards(JwtAuthGuard)
  @Get('membership')
  async getMembership(@Req() req: AuthenticatedRequest): Promise<MembershipResponseDto> {
    const plan = await this.getMembershipUseCase.execute(req.user.sub)
    return toMembershipResponse(plan)
  }
}
