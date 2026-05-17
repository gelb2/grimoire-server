import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common'
import { CreditLedgerPort } from '@domain/port/outbound/credit-ledger.port'
import { CreditSource } from '@domain/model/credit-source'
import { settleDeficitOnCharge } from '@domain/policy/credit-consumption-policy'

/**
 * 크레딧 개편 I Phase (2026-05-17) — 포인트 적립 UseCase.
 *
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-2, §8-4
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §5, §8-4
 *
 * 적립 4출처 (§8-2):
 *   - 가입 보너스 3,000pt / 첫 작품 2,000pt → source='free' (CAC)
 *   - 충전 (Polar 패키지) → source='charged' — 충전 시 deficit 우선 상계
 *   - 응원 선물 수령 1,000·3,000·5,000pt → source='gift'
 *   - 구독 월 풀 → source='subscription' (reset-monthly-pool.job 영역)
 *
 * §8-4 — 충전 시 deficit(외상) 우선 상계: 충전액에서 먼저 외상을 갚고 남은 만큼 적립.
 *
 * 헥사고날 — application 레이어. PrismaService import 0건 (CreditLedgerPort 경유).
 */
@Injectable()
export class GrantPointsUseCase {
  private readonly logger = new Logger(GrantPointsUseCase.name)

  /** 가입 보너스 포인트 (구 3 크레딧 → 3,000pt) */
  static readonly SIGNUP_BONUS_POINTS = 3000
  /** 첫 작품 등록 보너스 포인트 (구 2 크레딧 → 2,000pt) */
  static readonly FIRST_WORK_BONUS_POINTS = 2000

  constructor(
    @Inject('CreditLedgerPort')
    private readonly ledger: CreditLedgerPort,
  ) {}

  /** 가입 보너스 적립 (source='free' — CAC) */
  async grantSignupBonus(authorId: string): Promise<void> {
    await this.ledger.earn({
      authorId,
      source: 'free',
      amount: GrantPointsUseCase.SIGNUP_BONUS_POINTS,
      reason: 'signup_bonus',
    })
  }

  /** 첫 작품 등록 보너스 적립 (source='free' — CAC) */
  async grantFirstWorkBonus(authorId: string): Promise<void> {
    await this.ledger.earn({
      authorId,
      source: 'free',
      amount: GrantPointsUseCase.FIRST_WORK_BONUS_POINTS,
      reason: 'first_work_bonus',
    })
  }

  /**
   * 충전 적립 (source='charged') — Polar 결제 webhook 성공 시.
   *
   * §8-4 — deficit(외상) 우선 상계: 충전액에서 먼저 외상을 갚고 남은 만큼만 충전 적립.
   *
   * @param authorId 적립 대상
   * @param totalPoints 충전 패키지 총 포인트 (기본 + 보너스 — §8-5)
   * @param relatedId Payment id (감사 약결합)
   * @returns settledDeficit(상계된 외상), chargedPoints(실제 적립된 충전 pt)
   */
  async grantCharge(
    authorId: string,
    totalPoints: number,
    relatedId?: string,
  ): Promise<{ settledDeficit: number; chargedPoints: number }> {
    if (totalPoints <= 0) {
      throw new BadRequestException('충전 포인트는 양수여야 합니다')
    }

    // 1. deficit 우선 상계 (충전 즉시 최우선 — §8-4)
    const settledDeficit = await this.ledger.settleDeficit(authorId, totalPoints)

    // 2. 도메인 정책으로 남은 적립액 계산 (settleDeficit 가 반환한 값으로 재계산 — 일관)
    const { remainingCharge } = settleDeficitOnCharge(totalPoints, settledDeficit)

    // 3. 남은 충전액 적립 (외상이 충전액 전부를 잠식한 극단 케이스면 0 → earn 생략)
    if (remainingCharge > 0) {
      await this.ledger.earn({
        authorId,
        source: 'charged',
        amount: remainingCharge,
        reason: 'purchase_credit',
        relatedId,
      })
    }

    if (settledDeficit > 0) {
      this.logger.log(
        `충전 시 외상 상계 (authorId=${authorId}, settled=${settledDeficit}, ` +
          `charged=${remainingCharge}, total=${totalPoints})`,
      )
    }

    return { settledDeficit, chargedPoints: remainingCharge }
  }

  /** 응원 선물 수령 적립 (source='gift') — CreditUseCase.gift 의 수령자 측 */
  async grantGift(
    receiverId: string,
    points: number,
    relatedId?: string,
  ): Promise<void> {
    if (points <= 0) {
      throw new BadRequestException('선물 포인트는 양수여야 합니다')
    }
    await this.ledger.earn({
      authorId: receiverId,
      source: 'gift',
      amount: points,
      reason: 'gift_received',
      relatedId,
    })
  }

  /**
   * 운영자 수동 적립 — 임의 출처 지정 (AdminController credit 수동 부여 영역).
   * @param source 적립 출처 (운영자가 명시 — 보통 'charged' 또는 'free')
   */
  async grantManual(
    authorId: string,
    source: CreditSource,
    points: number,
    adminId: string,
  ): Promise<void> {
    if (points <= 0) {
      throw new BadRequestException('적립 포인트는 양수여야 합니다')
    }
    await this.ledger.earn({
      authorId,
      source,
      amount: points,
      reason: `admin_grant_by_${adminId}`,
    })
  }
}
