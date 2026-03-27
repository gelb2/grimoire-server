import { DailyViewCount } from '@domain/model/stats'

export interface StatsRepositoryPort {
  /** 일별 조회수 증가 (upsert) */
  incrementDailyView(workId: string, date: Date): Promise<void>
  /** 작품의 최근 N일 일별 조회수 조회 */
  getDailyViews(workId: string, days: number): Promise<DailyViewCount[]>
}
