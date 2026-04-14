import { EpisodeStatus } from '@domain/model/work'

/** 관리자 전용 데이터 접근 포트 — AdminUseCase 전용 */
export interface AdminRepositoryPort {
  // 통계
  countComments(): Promise<number>
  countCompletedPayments(): Promise<number>

  // 콘텐츠
  listWorks(options: { page: number; limit: number; query?: string; authorId?: string }): Promise<{ items: any[]; total: number }>
  getWorkDetail(workId: string): Promise<any | null>
  getEpisodeDetail(episodeId: string): Promise<any | null>
  changeEpisodeStatus(episodeId: string, status: EpisodeStatus): Promise<void>

  // 댓글
  listComments(options: { page: number; limit: number; episodeId?: string; query?: string }): Promise<{ items: any[]; total: number }>
  findComment(commentId: string): Promise<any | null>
  deleteComment(commentId: string): Promise<void>

  // 결제
  listPayments(options: { page: number; limit: number; authorId?: string; status?: string }): Promise<{ items: any[]; total: number }>
  getRevenueSummary(): Promise<{ totalRevenue: number; monthlyRevenue: number; products: any[] }>

  // 접근 로그
  listAccessLogs(options: { page: number; limit: number; action?: string; ip?: string; authorId?: string }): Promise<{ items: any[]; total: number }>

  // 제재
  createSanction(data: { authorId: string; type: string; reason: string; detail?: string; adminId: string; endAt: Date | null }): Promise<any>
  findSanction(sanctionId: string): Promise<any | null>
  liftSanction(sanctionId: string): Promise<void>
  listSanctions(authorId?: string): Promise<any[]>
  expireAndFindActiveSanction(authorId: string): Promise<any | null>

  // 신고
  listReports(options: { page: number; limit: number; status?: string }): Promise<{ items: any[]; total: number }>
  findReport(reportId: string): Promise<any | null>
  resolveReport(reportId: string, action: string, adminId: string): Promise<void>
  hideEpisode(episodeId: string): Promise<void>
  deleteCommentById(commentId: string): Promise<void>

  // 설정
  getSettings(): Promise<Record<string, string>>
  updateSetting(key: string, value: string, adminId: string): Promise<void>

  // 시계열
  getTimeseries(metric: string, since: Date): Promise<{ date: string; count: number }[]>

  // 공지
  listAnnouncements(page: number, limit: number): Promise<{ items: any[]; total: number }>
  createAnnouncement(adminId: string, data: { title: string; content: string; isPinned?: boolean; target?: string }): Promise<any>
  deleteAnnouncement(id: string): Promise<void>

  // 추천
  listFeatured(section?: string): Promise<any[]>
  addFeatured(adminId: string, data: { workId: string; section?: string; position?: number }): Promise<any>
  removeFeatured(id: string): Promise<void>

  // 시스템 테마
  listSystemThemes(): Promise<any[]>
  findSystemTheme(themeId: string): Promise<any | null>
  createSystemTheme(data: { name: string; preset: string; overrides: any }): Promise<any>
  updateSystemTheme(themeId: string, data: any): Promise<any>
  deleteSystemTheme(themeId: string): Promise<void>
}
