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

  async giftTransfer(
    senderId: string,
    receiverId: string,
    amount: number,
    senderReason: string,
    receiverReason: string,
  ): Promise<{ senderCredits: number; receiverCredits: number }> {
    return this.prisma.$transaction(async (tx) => {
      // 보내는 유저 차감
      const sender = await tx.author.update({
        where: { id: senderId },
        data: { credits: { decrement: amount } },
      })
      if (sender.credits < 0) {
        throw new Error('크레딧이 부족합니다')
      }

      // 받는 유저 적립
      const receiver = await tx.author.update({
        where: { id: receiverId },
        data: { credits: { increment: amount } },
      })

      // 로그 2건 기록
      await tx.creditLog.createMany({
        data: [
          { authorId: senderId, amount: -amount, reason: senderReason },
          { authorId: receiverId, amount, reason: receiverReason },
        ],
      })

      return { senderCredits: sender.credits, receiverCredits: receiver.credits }
    })
  }

  async getGiftRanking(limit: number): Promise<{ authorId: string; totalGifted: number }[]> {
    const rows = await this.prisma.creditLog.groupBy({
      by: ['authorId'],
      where: { reason: { startsWith: 'gift_received' } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: limit,
    })
    return rows.map(r => ({ authorId: r.authorId, totalGifted: r._sum.amount ?? 0 }))
  }

  async findLogsByAuthorId(authorId: string): Promise<CreditLog[]> {
    const rows = await this.prisma.creditLog.findMany({
      where: { authorId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toDomain)
  }

  async sumNegativeAmounts(): Promise<number> {
    const result = await this.prisma.creditLog.aggregate({
      _sum: { amount: true },
      where: { amount: { lt: 0 } },
    })
    return result._sum.amount ?? 0
  }
}

function toDomain(row: {
  id: string; authorId: string; amount: number; reason: string; createdAt: Date
}): CreditLog {
  return { id: row.id, authorId: row.authorId, amount: row.amount, reason: row.reason, createdAt: row.createdAt }
}
