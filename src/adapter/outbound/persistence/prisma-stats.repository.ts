import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { StatsRepositoryPort } from '@domain/port/outbound/stats-repository.port'
import { DailyViewCount } from '@domain/model/stats'

@Injectable()
export class PrismaStatsRepository implements StatsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** 일별 조회수 증가 — upsert로 해당 날짜 row 없으면 생성, 있으면 +1 */
  async incrementDailyView(workId: string, date: Date): Promise<void> {
    // 날짜를 UTC 자정으로 정규화
    const normalizedDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))

    await this.prisma.dailyView.upsert({
      where: {
        workId_date: { workId, date: normalizedDate },
      },
      create: { workId, date: normalizedDate, count: 1 },
      update: { count: { increment: 1 } },
    })
  }

  /** 최근 N일 일별 조회수 조회 */
  async getDailyViews(workId: string, days: number): Promise<DailyViewCount[]> {
    const now = new Date()
    const startDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - days + 1))

    const rows = await this.prisma.dailyView.findMany({
      where: {
        workId,
        date: { gte: startDate },
      },
      orderBy: { date: 'asc' },
    })

    // 빈 날짜를 0으로 채워 연속된 배열 생성
    const result: DailyViewCount[] = []
    const rowMap = new Map(rows.map(r => [r.date.toISOString().split('T')[0], r.count]))

    for (let i = 0; i < days; i++) {
      const d = new Date(startDate)
      d.setUTCDate(d.getUTCDate() + i)
      const dateStr = d.toISOString().split('T')[0]
      result.push({ date: dateStr, count: rowMap.get(dateStr) ?? 0 })
    }

    return result
  }
}
