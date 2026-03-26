import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditLog } from '@domain/model/credit'

@Injectable()
export class PrismaCreditRepository implements CreditRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async adjustCredits(
    authorId: string,
    amount: number,
    reason: string,
  ): Promise<{ credits: number; log: CreditLog }> {
    // 트랜잭션으로 원자적 처리
    const result = await this.prisma.$transaction(async (tx) => {
      const author = await tx.author.update({
        where: { id: authorId },
        data: { credits: { increment: amount } },
      })

      // 잔액이 음수가 되지 않도록 보정
      if (author.credits < 0) {
        throw new Error('크레딧이 부족합니다')
      }

      const log = await tx.creditLog.create({
        data: { authorId, amount, reason },
      })

      return { credits: author.credits, log: toDomain(log) }
    })

    return result
  }

  async findLogsByAuthorId(authorId: string): Promise<CreditLog[]> {
    const rows = await this.prisma.creditLog.findMany({
      where: { authorId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toDomain)
  }
}

function toDomain(row: {
  id: string; authorId: string; amount: number; reason: string; createdAt: Date
}): CreditLog {
  return { id: row.id, authorId: row.authorId, amount: row.amount, reason: row.reason, createdAt: row.createdAt }
}
