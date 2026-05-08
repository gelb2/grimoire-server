import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import {
  ReconciliationCheckpointRepositoryPort,
  ReconciliationCheckpointRecord,
} from '@domain/port/outbound/reconciliation-checkpoint-repository.port'

/**
 * ReconciliationCheckpoint Prisma 어댑터 — Sprint PAY-P0-2.
 *
 * - id='singleton' 단일 row 정책 (마이그레이션 INSERT seed로 보장).
 * - findSingleton: row 미존재 시 default seed 반환 (lastRunAt = 24h 전).
 * - update: upsert (insert if missing).
 */
@Injectable()
export class PrismaReconciliationCheckpointRepository
  implements ReconciliationCheckpointRepositoryPort
{
  private static readonly SINGLETON_ID = 'singleton'

  constructor(private readonly prisma: PrismaService) {}

  async findSingleton(): Promise<ReconciliationCheckpointRecord> {
    const row = await this.prisma.reconciliationCheckpoint.findUnique({
      where: { id: PrismaReconciliationCheckpointRepository.SINGLETON_ID },
    })
    if (row) {
      return row as unknown as ReconciliationCheckpointRecord
    }
    // default seed — 마이그레이션이 INSERT seed 박제하지만 안전망.
    const fallbackLastRunAt = new Date(Date.now() - 24 * 60 * 60 * 1000)
    return {
      id: PrismaReconciliationCheckpointRepository.SINGLETON_ID,
      lastRunAt: fallbackLastRunAt,
      processedCount: 0,
      boostCount: 0,
      mismatchCount: 0,
      expireCount: 0,
      errorMessage: null,
      updatedAt: new Date(),
    }
  }

  async update(data: {
    lastRunAt: Date
    processedCount: number
    boostCount: number
    mismatchCount: number
    expireCount: number
    errorMessage?: string | null
  }): Promise<ReconciliationCheckpointRecord> {
    const upserted = await this.prisma.reconciliationCheckpoint.upsert({
      where: { id: PrismaReconciliationCheckpointRepository.SINGLETON_ID },
      update: {
        lastRunAt: data.lastRunAt,
        processedCount: data.processedCount,
        boostCount: data.boostCount,
        mismatchCount: data.mismatchCount,
        expireCount: data.expireCount,
        errorMessage: data.errorMessage ?? null,
      },
      create: {
        id: PrismaReconciliationCheckpointRepository.SINGLETON_ID,
        lastRunAt: data.lastRunAt,
        processedCount: data.processedCount,
        boostCount: data.boostCount,
        mismatchCount: data.mismatchCount,
        expireCount: data.expireCount,
        errorMessage: data.errorMessage ?? null,
      },
    })
    return upserted as unknown as ReconciliationCheckpointRecord
  }
}
