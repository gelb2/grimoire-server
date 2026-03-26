import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { CreditLog } from '@domain/model/credit'

@Injectable()
export class AdminUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditUseCase: CreditUseCase,
  ) {}

  /** 플랫폼 통계 조회 */
  async getStats(): Promise<{
    totalAuthors: number
    totalWorks: number
    totalEpisodes: number
    totalCreditsConsumed: number
  }> {
    const [totalAuthors, totalWorks, totalEpisodes, creditLogs] = await Promise.all([
      this.prisma.author.count(),
      this.prisma.work.count(),
      this.prisma.episode.count(),
      this.prisma.creditLog.aggregate({ _sum: { amount: true }, where: { amount: { lt: 0 } } }),
    ])

    return {
      totalAuthors,
      totalWorks,
      totalEpisodes,
      totalCreditsConsumed: Math.abs(creditLogs._sum.amount || 0),
    }
  }

  /** 관리자 크레딧 부여 */
  async grantCredits(authorId: string, amount: number, reason: string): Promise<{ credits: number; log: CreditLog }> {
    return this.creditUseCase.grant(authorId, amount, reason)
  }
}
