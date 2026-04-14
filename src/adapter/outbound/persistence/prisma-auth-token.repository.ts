import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { AuthTokenRepositoryPort } from '@domain/port/outbound/auth-token-repository.port'

@Injectable()
export class PrismaAuthTokenRepository implements AuthTokenRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(authorId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.refreshToken.create({ data: { authorId, tokenHash, expiresAt } })
  }

  async findByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, authorId: true, expiresAt: true, revokedAt: true },
    })
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } })
  }

  async revokeByHash(tokenHash: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
  }

  async revokeAllByAuthorId(authorId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { authorId, revokedAt: null }, data: { revokedAt: new Date() } })
  }
}
