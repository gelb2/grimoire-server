import { Injectable, Inject, BadRequestException } from '@nestjs/common'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditLog } from '@domain/model/credit'

@Injectable()
export class CreditUseCase {
  constructor(
    @Inject('CreditRepositoryPort') private readonly creditRepo: CreditRepositoryPort,
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
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
