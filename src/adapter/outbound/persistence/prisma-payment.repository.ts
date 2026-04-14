import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { PaymentRepositoryPort, PaymentRecord } from '@domain/port/outbound/payment-repository.port'

@Injectable()
export class PrismaPaymentRepository implements PaymentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { authorId: string; productId: string; amount: number; credits: number }): Promise<PaymentRecord> {
    return this.prisma.payment.create({ data: { ...data, status: 'pending' } }) as unknown as PaymentRecord
  }

  async findByExternalTransactionId(tradeNo: string): Promise<PaymentRecord | null> {
    return this.prisma.payment.findUnique({ where: { externalTransactionId: tradeNo } }) as unknown as PaymentRecord | null
  }

  async updateExternalTransactionId(paymentId: string, tradeNo: string): Promise<void> {
    await this.prisma.payment.update({ where: { id: paymentId }, data: { externalTransactionId: tradeNo } })
  }

  async findByAuthorId(authorId: string): Promise<PaymentRecord[]> {
    return this.prisma.payment.findMany({ where: { authorId }, orderBy: { createdAt: 'desc' } }) as unknown as PaymentRecord[]
  }

  async completePaymentAtomically(paymentId: string, authorId: string, credits: number, productId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'completed', completedAt: new Date() },
      })
      await tx.author.update({
        where: { id: authorId },
        data: { credits: { increment: credits } },
      })
      await tx.creditLog.create({
        data: { authorId, amount: credits, reason: `purchase_${productId}_${paymentId}` },
      })
    })
  }

  async updateStatus(paymentId: string, status: string): Promise<void> {
    await this.prisma.payment.update({ where: { id: paymentId }, data: { status } })
  }
}
