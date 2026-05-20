import { Injectable, Inject, Optional, BadRequestException } from '@nestjs/common'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditLedgerPort, CreditBalance } from '@domain/port/outbound/credit-ledger.port'
import { CreditLog } from '@domain/model/credit'

@Injectable()
export class CreditUseCase {
  constructor(
    @Inject('CreditRepositoryPort') private readonly creditRepo: CreditRepositoryPort,
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    /**
     * 크레딧 개편 I Phase (2026-05-17) — CreditLedger 4 출처 회계 원장.
     * Optional — 주입 시 `getPointBalance` 가 4 출처 잔액(CreditBalance)을 반환,
     * 미주입 시 구 정수 `credits` 만 가용(BACKWARD COMPATIBLE — novel-analysis.usecase 패턴 차용).
     */
    @Optional()
    @Inject('CreditLedgerPort')
    private readonly ledger: CreditLedgerPort | null = null,
  ) {}

  async deduct(authorId: string, amount: number, reason: string): Promise<{ credits: number; log: CreditLog }> {
    if (amount <= 0) {
      throw new BadRequestException('차감 금액은 양수여야 합니다')
    }

    const author = await this.authorRepo.findById(authorId)
    if (!author) {
      throw new BadRequestException('작가를 찾을 수 없습니다')
    }
    if (author.credits < amount) {
      throw new BadRequestException('크레딧이 부족합니다')
    }

    return this.creditRepo.adjustCredits(authorId, -amount, reason)
  }

  async grant(authorId: string, amount: number, reason: string): Promise<{ credits: number; log: CreditLog }> {
    if (amount <= 0) {
      throw new BadRequestException('적립 금액은 양수여야 합니다')
    }
    return this.creditRepo.adjustCredits(authorId, amount, reason)
  }

  async getBalance(authorId: string): Promise<number> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) {
      throw new BadRequestException('작가를 찾을 수 없습니다')
    }
    return author.credits
  }

  /**
   * 크레딧 개편 I Phase (2026-05-17) — 4 출처 포인트 잔액 조회.
   *
   * `/credits/balance` HTTP 노출용. CreditLedgerPort(원장)가 주입되면 출처별
   * 잔액(무료 적립 / 구독 풀 / 응원 선물 / 충전) + deficit(외상) + 총합 + 가용량을
   * 반환한다. 정본: shared-contracts §30 CreditBalance.
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

  /** 응원받는 작가 랭킹 */
  async getGiftRanking(limit: number = 10): Promise<{ authorId: string; totalGifted: number }[]> {
    return this.creditRepo.getGiftRanking(limit)
  }

  async getLogs(authorId: string): Promise<CreditLog[]> {
    return this.creditRepo.findLogsByAuthorId(authorId)
  }
}
