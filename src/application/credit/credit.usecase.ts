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

  async getLogs(authorId: string): Promise<CreditLog[]> {
    return this.creditRepo.findLogsByAuthorId(authorId)
  }
}
