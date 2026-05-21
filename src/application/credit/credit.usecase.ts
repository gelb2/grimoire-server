import { Injectable, Inject, Optional, BadRequestException, Logger } from '@nestjs/common'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import {
  CreditLedgerPort,
  CreditBalance,
  CreditLedgerEntry,
} from '@domain/port/outbound/credit-ledger.port'
import { MembershipPlanPort } from '@domain/port/outbound/membership-plan.port'

/**
 * 크레딧 개편 CC-4 Phase 3 (2026-05-21) — 구 `CreditRepositoryPort` 폴백 제거.
 *
 * Phase 1 폐기 항목 (호출처 0건 확인 후 제거 완료):
 * - `deduct(authorId, amount, reason)` — `Author.credits` Int 차감. 차감 8경로(T1~T4) 전부
 *   `ChargePointsUseCase.charge*` 로 이행 완료 (CC-1).
 * - `grant(authorId, amount, reason)` — `Author.credits` Int 적립. 적립 8경로(T5~T8) 전부
 *   `GrantPointsUseCase.grant*` + `CreditLedgerPort.earn` 으로 이행 완료 (CC-1·CC-2a·CC-2b).
 * - `getBalance(authorId)` — `Author.credits` Int 단일 잔액. `getPointBalance` 4 출처 응답으로 대체.
 *
 * Phase 3 폐기 항목 (Phase 3 — 2026-05-21):
 * - `CreditRepositoryPort` DI 제거 — 잔존 폴백(`findLogsByAuthorId`/`getGiftRanking`) 제거 + 파일/Port 자체 삭제.
 * - `getGiftRanking`/`getLogs` ledger 미주입 폴백 제거 — `ledger` Required 강제 (미주입 시 BadRequest).
 *
 * 잔존 메서드 4종은 전부 신 시스템 단일 경로(CC-2b·CC-3·CC-4 Phase 3):
 *   - getPointBalance — CreditLedgerPort.getBalance (4 출처 + deficit + available)
 *   - gift          — CreditLedgerPort.transfer ($transaction)
 *   - getGiftRanking — CreditLedgerPort.getGiftRanking (단일 경로)
 *   - getLogs       — CreditLedgerPort.findByAuthor (단일 경로)
 */
@Injectable()
export class CreditUseCase {
  private readonly logger = new Logger(CreditUseCase.name)

  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    /**
     * 크레딧 개편 I Phase (2026-05-17) — CreditLedger 4 출처 회계 원장.
     * CC-4 Phase 3 (2026-05-21) — 구 `creditRepo` 폴백 제거 후에도 Optional 유지(spec/통합 spec 호환성).
     * 실 운영(`app.module.ts`)에서는 항상 주입 — 미주입 시 BadRequest.
     */
    @Optional()
    @Inject('CreditLedgerPort')
    private readonly ledger: CreditLedgerPort | null = null,
    /**
     * CC-3 (CRITICAL-1 案 B) — lazy 안전망. 잔액 조회 진입점에서 plan 만료 시 즉시 리셋.
     * Optional — 미주입 시 lazy 미적용(BACKWARD COMPATIBLE, cron 단일 안전망).
     * 정본: ADR-014.
     */
    @Optional()
    @Inject('MembershipPlanPort')
    private readonly membershipRepo: MembershipPlanPort | null = null,
  ) {}

  /**
   * 크레딧 개편 I Phase (2026-05-17) — 4 출처 포인트 잔액 조회.
   *
   * `/credits/balance` HTTP 노출용. CreditLedgerPort(원장)가 주입되면 출처별
   * 잔액(무료 적립 / 구독 풀 / 응원 선물 / 충전) + deficit(외상) + 총합 + 가용량을
   * 반환한다. 정본: shared-contracts §30 CreditBalance.
   *
   * CC-3 (CRITICAL-1 案 B) — lazy 안전망 진입점.
   * `MembershipPlanPort` 가 주입되면 `getBalance` 직전에 `checkAndResetExpiredPool` 호출:
   *   - plan 만료(poolResetAt < now) 시 즉시 `resetMonthlyPool` 실행 → 캐시 갱신.
   *   - cron 실패해도 작가가 잔액 보는 순간 자동 보정 → 이월 금지 코드 강제.
   * lazy 실패는 silent log + 잔액 조회 진행 (잔액 조회 자체 실패 방지 — fallback 안전망).
   *
   * @throws BadRequestException 작가 미존재
   */
  async getPointBalance(authorId: string): Promise<CreditBalance> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) {
      throw new BadRequestException('작가를 찾을 수 없습니다')
    }
    if (!this.ledger) {
      throw new BadRequestException('포인트 원장이 구성되지 않았습니다')
    }

    // CC-3 lazy 안전망 — membershipRepo 주입 시 plan 만료 자동 보정.
    if (this.membershipRepo) {
      try {
        await this.membershipRepo.checkAndResetExpiredPool(authorId, new Date())
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        // lazy 실패는 잔액 조회 자체를 막지 않음 — silent log + 진행
        this.logger.warn(
          `lazy checkAndResetExpiredPool 실패 (잔액 조회 진행) — authorId=${authorId} msg=${msg}`,
        )
      }
    }

    return this.ledger.getBalance(authorId)
  }

  /**
   * 응원 선물 (독자 → 작가) — CC-2b 案 G1 신 경로.
   *
   * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §1-B
   *       .claude/state/sprint-cc2b-gift-refund-wiring-plan-draft.md §3
   *
   * `CreditLedgerPort.transfer` 단일 `$transaction` 메서드가 양측 작가 이동을 원자 처리.
   * 구 `creditRepo.giftTransfer`(`Author.credits` Int + `CreditLog`) 경로는 제거.
   * sender 잔액 검증·자기 선물 차단은 `transfer` 내부에서 수행 — 본 메서드는 사전 검증만 보존.
   *
   * @param amount pt 단위 (메인 §6 결정 — 1,000/3,000/5,000pt, `GIFT_POINT_OPTIONS` 정본).
   * @returns 양측 작가 갱신 결과 — `senderSpentBySource`(4 출처 차감액) / `receiverGiftBalance`(받는 작가 pointsGift)
   */
  async gift(
    senderId: string,
    receiverId: string,
    amount: number,
  ): Promise<{
    senderSpentBySource: Record<'free' | 'subscription' | 'gift' | 'charged', number>
    receiverGiftBalance: number
  }> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestException('선물 금액은 양의 정수여야 합니다')
    }
    if (senderId === receiverId) {
      throw new BadRequestException('자기 자신에게 선물할 수 없습니다')
    }
    if (!this.ledger) {
      // CC-2b 신 경로 — CreditLedgerPort 가 정본. ledger 없으면 응답 불가.
      throw new BadRequestException('포인트 원장이 구성되지 않았습니다')
    }

    // sender·receiver 미존재 검증은 transfer 내부 FOR UPDATE 가 throw 로 처리하지만,
    // controller 친화적 400 응답을 위해 사전 검증 보존.
    const sender = await this.authorRepo.findById(senderId)
    if (!sender) {
      throw new BadRequestException('보내는 유저를 찾을 수 없습니다')
    }
    const receiver = await this.authorRepo.findById(receiverId)
    if (!receiver) {
      throw new BadRequestException('받는 유저를 찾을 수 없습니다')
    }

    try {
      // 단일 $transaction — sender 차감(planConsumption) + receiver gift earn
      return await this.ledger.transfer(senderId, receiverId, amount, undefined)
    } catch (e: unknown) {
      // 잔액 부족(외상 선물 불가)을 4xx 로 정리 — 그 외 throw 위임
      const message = e instanceof Error ? e.message : String(e)
      if (message.includes('포인트가 부족') || message.includes('크레딧이 부족')) {
        throw new BadRequestException('포인트가 부족합니다')
      }
      throw e
    }
  }

  /**
   * 응원받는 작가 랭킹 — CC-3 (HIGH-3) `CreditLedger` 단일 경로.
   *
   * CC-2b 가 선물 적립을 `CreditLedger source='gift', type='earn'` 으로 이행하면서
   * 구 `creditRepo.getGiftRanking`(`CreditLog reason='gift_received'` groupBy)이 신 선물을
   * 못 보는 **신·구 분열** 발생. CC-3 가 신 ledger 기반 집계로 재작성.
   * CC-4 Phase 3 (2026-05-21) — 구 `creditRepo.getGiftRanking` 폴백 제거.
   *
   * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §5-B / ADR-014.
   */
  async getGiftRanking(limit: number = 10): Promise<{ authorId: string; totalGifted: number }[]> {
    if (!this.ledger) {
      throw new BadRequestException('포인트 원장이 구성되지 않았습니다')
    }
    return this.ledger.getGiftRanking(limit)
  }

  /**
   * 작가 크레딧 이력 조회 — CC-3 (HIGH-3) `CreditLedger` 단일 경로.
   *
   * 반환 타입: `CreditLedgerEntry[]` (구 `CreditLog[]` 폴백 제거 — CC-4 Phase 3).
   * `GET /credits/logs` 응답 형태가 신 4 출처 모델(source/type/balanceAfter/expiresAt/relatedId)로 확장.
   * shared-contracts §30 + docs/api-contract.md 변경 이력 박제.
   */
  async getLogs(authorId: string): Promise<CreditLedgerEntry[]> {
    if (!this.ledger) {
      throw new BadRequestException('포인트 원장이 구성되지 않았습니다')
    }
    return this.ledger.findByAuthor(authorId, 100)
  }
}
