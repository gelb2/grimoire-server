import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import {
  AnalysisReportRepositoryPort,
  AnalysisReport,
  AnalysisReportSummary,
} from '@domain/port/outbound/analysis-report-repository.port'
import { AnalysisResult } from '@lib/rag'

type AnalysisType = 'consistency' | 'tone' | 'character'

@Injectable()
export class PrismaAnalysisReportRepository implements AnalysisReportRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    authorId: string
    workId: string
    episodeId: string
    workTitle: string
    episodeTitle: string
    types: AnalysisType[]
    results: AnalysisResult[]
    creditsCharged: number
  }): Promise<AnalysisReport> {
    const row = await this.prisma.analysisReport.create({
      data: {
        authorId: input.authorId,
        workId: input.workId,
        episodeId: input.episodeId,
        workTitle: input.workTitle,
        episodeTitle: input.episodeTitle,
        types: input.types,
        results: input.results as unknown as object,
        creditsCharged: input.creditsCharged,
      },
    })
    return toReport(row)
  }

  async findByAuthor(authorId: string, limit = 50): Promise<AnalysisReportSummary[]> {
    const rows = await this.prisma.analysisReport.findMany({
      where: { authorId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        workId: true,
        episodeId: true,
        workTitle: true,
        episodeTitle: true,
        types: true,
        results: true,
        creditsCharged: true,
        createdAt: true,
      },
    })
    return rows.map((r) => {
      const results = (r.results as unknown as AnalysisResult[]) ?? []
      return {
        id: r.id,
        workId: r.workId,
        episodeId: r.episodeId,
        workTitle: r.workTitle,
        episodeTitle: r.episodeTitle,
        types: r.types as AnalysisType[],
        scores: results.map((res) => ({ type: res.type, score: res.score })),
        creditsCharged: r.creditsCharged,
        createdAt: r.createdAt,
      }
    })
  }

  async findById(id: string): Promise<AnalysisReport | null> {
    const row = await this.prisma.analysisReport.findUnique({ where: { id } })
    return row ? toReport(row) : null
  }
}

function toReport(row: {
  id: string
  authorId: string
  workId: string
  episodeId: string
  workTitle: string
  episodeTitle: string
  types: string[]
  results: unknown
  creditsCharged: number
  createdAt: Date
}): AnalysisReport {
  return {
    id: row.id,
    authorId: row.authorId,
    workId: row.workId,
    episodeId: row.episodeId,
    workTitle: row.workTitle,
    episodeTitle: row.episodeTitle,
    types: row.types as AnalysisType[],
    results: (row.results as AnalysisResult[]) ?? [],
    creditsCharged: row.creditsCharged,
    createdAt: row.createdAt,
  }
}
