import { Injectable, Inject, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { MembershipPlanPort } from '@domain/port/outbound/membership-plan.port'

/**
 * 크레딧 개편 I Phase (2026-05-17) — 구독 월 포인트 풀 리셋 cron job.
 *
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-3, §8-6
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §5, §8-6
 *
 * §8-8 CRITICAL #2 — 풀 이월 금지. 매월 리셋 시 잔여 풀은 만료 처리:
 *   - poolResetAt 경과한 활성 pro/premium 멤버십 조회
 *   - 각 멤버십을 resetMonthlyPool 호출 → 잔여 풀 expire ledger + 신규 풀 earn ledger
 *   - poolBalance = monthlyPoolPoints 로 재설정 (이월 X — 이번 달 풀로 덮어씀)
 *
 * cron + lazy 이중 안전망 (§8-6):
 *   - 본 cron 이 1차 — 매일 새벽 4시 (PAY-P2-5 audit-mask / USER-SOFT-DELETE 와 동일 시간대 패턴)
 *   - cron 실패 대비, 조회 시점 lazy 리셋은 별도(getPlan 호출처에서 poolResetAt 체크 — I Phase 후속)
 *
 * 동시 실행 차단: in-memory isRunning 플래그 + try-finally (PaymentCleanupJob 패턴).
 * 비활성화 게이트: process.env.MONTHLY_POOL_RESET_DISABLED === '1' 즉시 return.
 *
 * 헥사고날 — application 레이어. PrismaService import 0건 (MembershipPlanPort 경유).
 */
@Injectable()
export class ResetMonthlyPoolJob {
  private readonly logger = new Logger(ResetMonthlyPoolJob.name)
  /** 동시 실행 차단 플래그 — 같은 process 내 cron 중복 호출 방지 */
  private isRunning = false

  constructor(
    @Inject('MembershipPlanPort')
    private readonly membershipRepo: MembershipPlanPort,
  ) {}

  /**
   * cron 진입점 — 매일 새벽 4시 ('0 0 4 * * *').
   * 매일 실행하되 poolResetAt 경과한 멤버십만 리셋 — 가입일 분산 대응(월초 일괄 X).
   */
  @Cron('0 0 4 * * *')
  async resetExpiredPools(): Promise<void> {
    if (process.env.MONTHLY_POOL_RESET_DISABLED === '1') {
      this.logger.warn(
        'MONTHLY_POOL_RESET_DISABLED=1 — 월 풀 리셋 cron 비활성화 (skip)',
      )
      return
    }

    if (this.isRunning) {
      this.logger.warn('ResetMonthlyPoolJob 이미 실행 중 — 동시 실행 차단 (skip)')
      return
    }

    this.isRunning = true
    const startedAt = new Date()

    try {
      const result = await this.runResetPass(startedAt)
      this.logger.log(
        `ResetMonthlyPoolJob 완료 — resetCount=${result.resetCount} ` +
          `failedCount=${result.failedCount} candidateCount=${result.candidateCount}`,
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error(`ResetMonthlyPoolJob 예외 — ${msg}`)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * 리셋 1회 수행 (테스트 + 운영자 직접 호출용).
   *
   * @param now 현재 시각 (테스트 주입 강제)
   * @returns resetCount(리셋 성공), failedCount(개별 실패), candidateCount(대상 수)
   */
  async runResetPass(now: Date): Promise<{
    resetCount: number
    failedCount: number
    candidateCount: number
  }> {
    const candidates = await this.membershipRepo.findPlansToReset(now)
    this.logger.log(
      `ResetMonthlyPoolJob 시작 — startedAt=${now.toISOString()} ` +
        `candidateCount=${candidates.length}`,
    )

    let resetCount = 0
    let failedCount = 0

    for (const plan of candidates) {
      try {
        await this.membershipRepo.resetMonthlyPool(plan.authorId, now)
        resetCount += 1
        this.logger.log(
          `[reset] authorId=${plan.authorId} tier=${plan.tier} ` +
            `prevPoolBalance=${plan.poolBalance} → ${plan.monthlyPoolPoints}`,
        )
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.error(
          `[reset] authorId=${plan.authorId} 리셋 실패 — ${msg}`,
        )
        failedCount += 1
        // 본 멤버십만 실패 박제 — 다음 cron 에서 재시도. 다른 멤버십 처리 계속.
      }
    }

    return {
      resetCount,
      failedCount,
      candidateCount: candidates.length,
    }
  }
}
