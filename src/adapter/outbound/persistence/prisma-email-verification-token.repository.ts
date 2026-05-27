import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import {
  EmailVerificationTokenRecord,
  EmailVerificationTokenRepositoryPort,
} from '@domain/port/outbound/email-verification-token-repository.port'
import { EmailTokenPurpose } from '@domain/model/email-verification-token'

/**
 * Prisma 어댑터 — EmailVerificationTokenRepositoryPort 구현.
 *
 * 정본: `.claude/state/sprint-email-polar-ready-plan-draft.md` §7
 */
@Injectable()
export class PrismaEmailVerificationTokenRepository
  implements EmailVerificationTokenRepositoryPort
{
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    authorId: string
    email: string
    tokenHash: string
    purpose: EmailTokenPurpose
    expireAt: Date
  }): Promise<EmailVerificationTokenRecord> {
    const row = await this.prisma.emailVerificationToken.create({
      data: {
        authorId: input.authorId,
        email: input.email,
        tokenHash: input.tokenHash,
        purpose: input.purpose,
        expireAt: input.expireAt,
      },
    })
    return this.mapRow(row)
  }

  async findByTokenHash(tokenHash: string): Promise<EmailVerificationTokenRecord | null> {
    const row = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    })
    return row ? this.mapRow(row) : null
  }

  async markRedeemed(id: string, redeemedAt: Date): Promise<void> {
    await this.prisma.emailVerificationToken.update({
      where: { id },
      data: { redeemedAt },
    })
  }

  async deleteExpired(now: Date): Promise<{ count: number }> {
    const result = await this.prisma.emailVerificationToken.deleteMany({
      where: { expireAt: { lt: now } },
    })
    return { count: result.count }
  }

  private mapRow(row: {
    id: string
    authorId: string
    email: string
    tokenHash: string
    purpose: string
    expireAt: Date
    redeemedAt: Date | null
    createdAt: Date
  }): EmailVerificationTokenRecord {
    return {
      id: row.id,
      authorId: row.authorId,
      email: row.email,
      tokenHash: row.tokenHash,
      purpose: row.purpose as EmailTokenPurpose,
      expireAt: row.expireAt,
      redeemedAt: row.redeemedAt,
      createdAt: row.createdAt,
    }
  }
}
