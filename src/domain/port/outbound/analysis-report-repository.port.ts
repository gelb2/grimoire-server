import { AnalysisResult } from '@lib/rag'

export interface AnalysisReport {
  id: string
  authorId: string
  workId: string
  episodeId: string
  workTitle: string
  episodeTitle: string
  types: ('consistency' | 'tone' | 'character')[]
  results: AnalysisResult[]
  creditsCharged: number
  createdAt: Date
}

/** 분석 리포트 리스트 항목 (상세 조회 전 preview용 — results는 미포함) */
export interface AnalysisReportSummary {
  id: string
  workId: string
  episodeId: string
  workTitle: string
  episodeTitle: string
  types: ('consistency' | 'tone' | 'character')[]
  /** types별 점수 요약 (-1은 실패) */
  scores: { type: 'consistency' | 'tone' | 'character'; score: number }[]
  creditsCharged: number
  createdAt: Date
}

export interface AnalysisReportRepositoryPort {
  create(input: {
    authorId: string
    workId: string
    episodeId: string
    workTitle: string
    episodeTitle: string
    types: ('consistency' | 'tone' | 'character')[]
    results: AnalysisResult[]
    creditsCharged: number
  }): Promise<AnalysisReport>

  /** 작가의 분석 히스토리 (최신순, 간단 요약만) */
  findByAuthor(authorId: string, limit?: number): Promise<AnalysisReportSummary[]>

  /** 단건 상세 조회 (소유권 검증은 UseCase에서) */
  findById(id: string): Promise<AnalysisReport | null>
}
