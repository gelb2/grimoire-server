import { Injectable, Inject } from '@nestjs/common'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { CreditLog } from '@domain/model/credit'

@Injectable()
export class AdminUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('CreditRepositoryPort') private readonly creditRepo: CreditRepositoryPort,
    private readonly creditUseCase: CreditUseCase,
  ) {}

  /** 플랫폼 통계 조회 */
  async getStats(): Promise<{
    totalAuthors: number
    totalWorks: number
    totalEpisodes: number
    totalCreditsConsumed: number
  }> {
    const [totalAuthors, totalWorks, totalEpisodes, totalCreditsConsumed] = await Promise.all([
      this.authorRepo.count(),
      this.workRepo.countAll(),
      this.workRepo.countAllEpisodes(),
      this.creditRepo.sumNegativeAmounts(),
    ])

    return {
      totalAuthors,
      totalWorks,
      totalEpisodes,
      totalCreditsConsumed: Math.abs(totalCreditsConsumed),
    }
  }

  /** 관리자 크레딧 부여 */
  async grantCredits(authorId: string, amount: number, reason: string): Promise<{ credits: number; log: CreditLog }> {
    return this.creditUseCase.grant(authorId, amount, reason)
  }
}
