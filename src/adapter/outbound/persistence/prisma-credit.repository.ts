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
    // Serializable 트랜잭션 — 동시 크레딧 변경 시 데드락 방지
    const result = await this.prisma.$transaction(async (tx) => {
      // SELECT FOR UPDATE: 같은 작가 행을 동시 수정하는 트랜잭션을 직렬화
      const [locked] = await tx.$queryRawUnsafe<{ credits: number }[]>(
        'SELECT credits FROM authors WHERE id = $1 FOR UPDATE',
        authorId,
      )
      if (!locked) throw new Error('작가를 찾을 수 없습니다')

      // 차감 시 잔액 검증을 UPDATE 전에 수행
      const newBalance = locked.credits + amount
      if (newBalance < 0) {
        throw new Error('크레딧이 부족합니다')
      }

      const author = await tx.author.update({
        where: { id: authorId },
        data: { credits: newBalance },
      })

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
      // 데드락 방지: ID 순서로 잠금 (항상 작은 ID를 먼저 잠금)
      const [firstId, secondId] = senderId < receiverId
        ? [senderId, receiverId]
        : [receiverId, senderId]

      const rows = await tx.$queryRawUnsafe<{ id: string; credits: number }[]>(
        'SELECT id, credits FROM authors WHERE id IN ($1, $2) ORDER BY id FOR UPDATE',
        firstId, secondId,
      )
      const senderRow = rows.find(r => r.id === senderId)
      const receiverRow = rows.find(r => r.id === receiverId)
      if (!senderRow || !receiverRow) throw new Error('유저를 찾을 수 없습니다')

      if (senderRow.credits < amount) {
        throw new Error('크레딧이 부족합니다')
      }

      const sender = await tx.author.update({
        where: { id: senderId },
        data: { credits: senderRow.credits - amount },
      })
      const receiver = await tx.author.update({
        where: { id: receiverId },
        data: { credits: receiverRow.credits + amount },
      })

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
