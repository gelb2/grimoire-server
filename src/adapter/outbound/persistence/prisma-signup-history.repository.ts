import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { SignupHistoryRepositoryPort } from '@domain/port/outbound/signup-history-repository.port'

@Injectable()
export class PrismaSignupHistoryRepository implements SignupHistoryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByProviderId(providerId: string): Promise<{ signupCount: number } | null> {
    return this.prisma.signupHistory.findUnique({
      where: { providerId },
      select: { signupCount: true },
    })
  }

  async upsert(providerId: string): Promise<void> {
    await this.prisma.signupHistory.upsert({
      where: { providerId },
      create: { providerId, signupCount: 1 },
      update: { signupCount: { increment: 1 } },
    })
  }
}
