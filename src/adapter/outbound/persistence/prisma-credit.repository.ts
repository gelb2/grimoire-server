import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditLog } from '@domain/model/credit'

/**
 * 크레딧 개편 CC-4 Phase 1 (2026-05-21) — 폐기 어댑터. Phase 3 에서 파일 자체 제거 예정.
 *
 * 잔존 메서드 2종은 ledger 미주입 시 폴백 경로 (테스트용):
 *   - `findLogsByAuthorId` — `CreditUseCase.getLogs` 폴백
 *   - `getGiftRanking`     — `CreditUseCase.getGiftRanking` 폴백
 * 제거된 메서드 (Phase 1):
 *   - `adjustCredits` — 차감/적립 신 시스템(`ChargePointsUseCase`/`GrantPointsUseCase`) 이행 완료
 *   - `giftTransfer` — `CreditLedgerPort.transfer` 단일 경로
 *   - `sumNegativeAmounts` — `CreditLedgerPort.sumSpendByAuthor` 단일 경로
 */
@Injectable()
export class PrismaCreditRepository implements CreditRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

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
}

function toDomain(row: {
  id: string; authorId: string; amount: number; reason: string; createdAt: Date
}): CreditLog {
  return { id: row.id, authorId: row.authorId, amount: row.amount, reason: row.reason, createdAt: row.createdAt }
}
