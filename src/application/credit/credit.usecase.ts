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

  /** 크레딧 선물 (독자 → 작가, 트랜잭션) */
  async gift(senderId: string, receiverId: string, amount: number): Promise<{ senderCredits: number; receiverCredits: number }> {
    if (amount <= 0) {
      throw new BadRequestException('선물 금액은 양수여야 합니다')
    }
    if (senderId === receiverId) {
      throw new BadRequestException('자기 자신에게 선물할 수 없습니다')
    }

    const sender = await this.authorRepo.findById(senderId)
    if (!sender) {
      throw new BadRequestException('보내는 유저를 찾을 수 없습니다')
    }
    if (sender.credits < amount) {
      throw new BadRequestException('크레딧이 부족합니다')
    }

    const receiver = await this.authorRepo.findById(receiverId)
    if (!receiver) {
      throw new BadRequestException('받는 유저를 찾을 수 없습니다')
    }

    return this.creditRepo.giftTransfer(
      senderId,
      receiverId,
      amount,
      `gift_sent:${receiverId}`,
      `gift_received:${senderId}`,
    )
  }

  /** 응원받는 작가 랭킹 */
  async getGiftRanking(limit: number = 10): Promise<{ authorId: string; totalGifted: number }[]> {
    return this.creditRepo.getGiftRanking(limit)
  }

  async getLogs(authorId: string): Promise<CreditLog[]> {
    return this.creditRepo.findLogsByAuthorId(authorId)
  }
}
