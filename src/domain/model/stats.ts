/** 일별 조회수 */
export interface DailyViewCount {
  date: string
  count: number
}

/** 작품 조회수 통계 응답 */
export interface WorkStats {
  dates: string[]
  counts: number[]
  totalViews: number
}
