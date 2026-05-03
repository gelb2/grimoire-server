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

  /**
   * pending Payment 중 createdAt이 N시간 이상 경과한 row 조회 (Sprint PAY-P0-2).
   * cron이 expire 대상 후보를 식별할 때 사용.
   */
  async findPendingPaymentsOlderThan(hours: number): Promise<PaymentRecord[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
    return (await this.prisma.payment.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
    })) as unknown as PaymentRecord[]
  }

  /**
   * pending Payment를 expired로 만료 처리 (Sprint PAY-P0-2).
   * - status가 pending일 때만 expired로 갱신 (이미 다른 상태면 skip).
   * - 크레딧 변동 0건 — payment 미완료였으므로 환수 대상 아님.
   */
  async expirePayment(paymentId: string): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { id: paymentId, status: 'pending' },
      data: { status: 'expired' },
    })
  }
}
