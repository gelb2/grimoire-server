import { Injectable, Inject, Logger, BadRequestException, ForbiddenException, NotFoundException, Optional } from '@nestjs/common'
import { VectorStorePort } from '@domain/port/outbound/vector-store.port'
import { EmbeddingPort } from '@domain/port/outbound/embedding.port'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import {
  AnalysisReportRepositoryPort,
  AnalysisReport,
  AnalysisReportSummary,
} from '@domain/port/outbound/analysis-report-repository.port'
import { CreditReason } from '@domain/model/credit'
import { CreditSource } from '@domain/model/credit-source'
import { ANALYSIS_CREDIT_COST } from '@domain/model/config'
import { ANALYSIS_POINT_COST } from '@domain/model/chat-charge-tier'
import { ChargePointsUseCase } from '@application/credit/charge-points.usecase'
import { chunkText, checkConsistency, checkTone, checkCharacter, AnalysisResult, WorkMeta } from '@lib/rag'
import { abortableRace, throwIfAborted } from '@lib/abort'

@Injectable()
export class NovelAnalysisUseCase {
  private readonly logger = new Logger(NovelAnalysisUseCase.name)

  constructor(
    @Inject('VectorStorePort') private readonly vectorStore: VectorStorePort,
    @Inject('EmbeddingPort') private readonly embedding: EmbeddingPort,
    @Inject('ClaudeApiPort') private readonly claude: ClaudeApiPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('CreditRepositoryPort') private readonly creditRepo: CreditRepositoryPort,
    @Inject('AnalysisReportRepositoryPort')
    private readonly reportRepo: AnalysisReportRepositoryPort,
    /**
     * 크레딧 개편 I Phase (2026-05-17) — 디노미네이션 분석 차감 (2,440pt).
     * Optional — 주입 시 디노미 차감(ANALYSIS_POINT_COST) 우선, 미주입 시 구 정수 크레딧 차감(BACKWARD COMPATIBLE).
     */
    @Optional()
    private readonly chargePoints: ChargePointsUseCase | null = null,
  ) {}

  /** 에피소드 텍스트를 벡터화하여 인덱싱 */
  async indexEpisode(episodeId: string, workId: string, rawText: string): Promise<{ chunkCount: number; tokensUsed: number }> {
    await this.vectorStore.ensureTable()

    // 기존 청크 삭제 (재인덱싱)
    await this.vectorStore.deleteByEpisode(episodeId)

    // 텍스트 청킹
    const chunks = chunkText(rawText)
    if (chunks.length === 0) return { chunkCount: 0, tokensUsed: 0 }

    // 배치 임베딩 생성
    const { embeddings, tokensUsed } = await this.embedding.getEmbeddingsBatch(
      chunks.map((c) => c.text),
      10,
    )

    // 벡터 DB에 저장
    for (let i = 0; i < chunks.length; i++) {
      await this.vectorStore.insertChunk(
        `${episodeId}_${chunks[i].index}`,
        workId,
        episodeId,
        chunks[i].index,
        chunks[i].text,
        embeddings[i],
      )
    }

    return { chunkCount: chunks.length, tokensUsed }
  }

  /**
   * 이미 업로드된 에피소드와 같은 작품의 다른 회차 사이의 일관성 분석 (RAG, Q1=(a) 모드)
   *
   * Claude Projects 벤치마크 (`docs/ai-analysis-spec.md §6-1`):
   * - 작가는 회차를 업로드한 시점에 이미 본문을 제공한 상태 → **분석 화면에서 본문 재입력 금지**
   * - 회차 1개를 선택하면 서버가 DB에서 `Episode.rawMd`를 로드해 분석에 사용
   * - 자기 자신 청크는 RAG 검색에서 자동 제외(self-reference 환각 방지)
   *
   * Claude Projects 스타일 강화:
   * - Work 메타(title/context/instructions) 로드 → 시스템 프롬프트 동적 주입
   * - 에피소드 제목을 컨텍스트 라벨에 포함 (`[제9화 "도리안그레이의 초상" · 청크 3]`)
   * - 3종 분석을 Promise.all 병렬 호출 (latency 1/3)
   * - 응답의 issues 인용이 실제 에피소드 텍스트에 존재하는지 후처리 검증 (환각 제거)
   *
   * 크레딧 차감 (F2 2026-04-19, 2026-04-27 4 크레딧으로 인상):
   * - 실행 전 ANALYSIS_CREDIT_COST(4) 크레딧 차감 — 부족 시 BadRequest
   * - AI 호출 실패 시 전액 환불
   *
   * 보안 (CLAUDE.md §0 정책 강제):
   * - Episode → workId → Work.authorId === authorId 검증 (IDOR 방지)
   * - body.workId는 신뢰하지 않고 Episode 실제 workId만 사용
   *
   * 파라미터:
   * - authorId — JWT `sub` 경유, 크레딧 차감 + 소유권 검증 대상
   * - episodeId — 분석할 회차 ID (DB에 인덱싱되어 있어야 의미 있는 결과)
   */
  async analyzeEpisode(
    authorId: string,
    episodeId: string,
    analysisTypes: ('consistency' | 'tone' | 'character')[] = ['consistency', 'tone', 'character'],
    // 컨트롤러에서 HTTP request close 이벤트를 AbortSignal로 변환해 전달.
    // abort 시 내부 Promise.race가 AbortedError로 reject되어 환불이 보장된다.
    abortSignal?: AbortSignal,
  ): Promise<AnalysisResult[]> {
    // 0. 에피소드 로드 + 소유권 검증 (크레딧 차감 전에 실패해야 환불 케이스 발생 안 함)
    const episode = await this.workRepo.findEpisodeById(episodeId)
    if (!episode) {
      throw new BadRequestException('에피소드를 찾을 수 없습니다')
    }
    const work = await this.workRepo.findById(episode.workId)
    if (!work) {
      throw new BadRequestException('작품을 찾을 수 없습니다')
    }
    if (work.authorId !== authorId) {
      throw new BadRequestException('본인 작품의 에피소드만 분석할 수 있습니다')
    }
    if (!episode.rawMd || episode.rawMd.length < 10) {
      throw new BadRequestException('에피소드 본문이 너무 짧아 분석할 수 없습니다')
    }

    // 분석 차감 (PLANNING §14, ai-cost-table §3-2).
    // 크레딧 개편 I Phase — chargePoints 주입 시 디노미 차감(2,440pt), 미주입 시 구 정수 크레딧 차감.
    // CC-1 §5-D — 차감 SpendResult.spentBySource 를 보유했다가 실패 환불 시 출처별 복원에 사용.
    let spentBySource: Record<string, number> | undefined
    if (this.chargePoints) {
      // 디노미 차감 — charge-points.usecase 가 잔액 부족 시 BadRequest throw
      const spendResult = await this.chargePoints.chargeAnalysis(authorId)
      spentBySource = spendResult.spentBySource
    } else {
      try {
        await this.creditRepo.adjustCredits(authorId, -ANALYSIS_CREDIT_COST, CreditReason.NOVEL_ANALYSIS)
      } catch {
        throw new BadRequestException(
          `AI 분석은 ${ANALYSIS_CREDIT_COST} 크레딧이 필요합니다. 크레딧이 부족합니다.`,
        )
      }
    }

    let results: AnalysisResult[]
    try {
      // self-reference 환각 방지를 위해 분석 대상 에피소드 자신은 RAG에서 자동 제외
      results = await this.runAnalysis(episode.workId, episode.rawMd, analysisTypes, episodeId, abortSignal)
    } catch (error) {
      // 실패(AbortedError 포함) 시 환불 — CC-1 §5-D: 차감 출처별로 정확히 복원
      if (this.chargePoints) {
        await this.chargePoints
          .refundAnalysis(authorId, undefined, spentBySource as Record<CreditSource, number> | undefined)
          .catch((e) => this.logger.error(`환불 실패: ${String(e)}`))
      } else {
        await this.creditRepo
          .adjustCredits(authorId, ANALYSIS_CREDIT_COST, CreditReason.NOVEL_ANALYSIS_REFUND)
          .catch((e) => this.logger.error(`환불 실패: ${String(e)}`))
      }
      throw error
    }

    // 성공 시 분석 리포트를 영구 저장 (대시보드 히스토리용).
    // DB 실패로 응답 자체가 실패하지 않도록 catch로 보호 — 결과는 반환하되 로그만 남김.
    try {
      await this.reportRepo.create({
        authorId,
        workId: episode.workId,
        episodeId,
        workTitle: work.title,
        episodeTitle: episode.title,
        types: analysisTypes,
        results,
        // 크레딧 개편 I Phase — 디노미 차감 시 pt 단위(2,440), 구 경로면 정수 크레딧(4)
        creditsCharged: this.chargePoints ? ANALYSIS_POINT_COST : ANALYSIS_CREDIT_COST,
      })
    } catch (err) {
      this.logger.error(`분석 리포트 저장 실패 (결과는 반환): ${String(err)}`)
    }

    return results
  }

  /** 작가의 분석 히스토리 목록 조회 (최신순, 50건 상한) */
  async listReports(authorId: string): Promise<AnalysisReportSummary[]> {
    return this.reportRepo.findByAuthor(authorId, 50)
  }

  /** 단건 상세 조회 + 소유권 검증 */
  async getReport(authorId: string, reportId: string): Promise<AnalysisReport> {
    const report = await this.reportRepo.findById(reportId)
    if (!report) throw new NotFoundException('분석 리포트를 찾을 수 없습니다')
    if (report.authorId !== authorId) {
      throw new ForbiddenException('본인의 분석 리포트만 조회할 수 있습니다')
    }
    return report
  }

  /** 분석 실제 실행 (크레딧 로직과 분리) */
  private async runAnalysis(
    workId: string,
    newEpisodeText: string,
    analysisTypes: ('consistency' | 'tone' | 'character')[],
    excludeEpisodeId: string,
    abortSignal?: AbortSignal,
  ): Promise<AnalysisResult[]> {
    throwIfAborted(abortSignal)
    // 작품 메타 + 에피소드 제목 매핑 병렬 로드
    const [work, episodeSummaries] = await abortableRace(abortSignal, Promise.all([
      this.workRepo.findById(workId).catch(() => null),
      this.workRepo.findEpisodes(workId).catch(() => []),
    ]))
    const workMeta: WorkMeta | undefined = work
      ? { title: work.title, context: work.context, instructions: work.instructions }
      : undefined
    const episodeTitleMap = new Map<string, { title: string; orderNum: number; type: string }>()
    for (const ep of episodeSummaries) {
      episodeTitleMap.set(ep.id, { title: ep.title, orderNum: ep.orderNum, type: ep.type })
    }

    throwIfAborted(abortSignal)
    // 분석 대상 에피소드 본문으로 RAG 검색 (자기 자신 청크가 항상 1순위라 30개 검색 후 제외)
    const queryEmbedding = await abortableRace(abortSignal, this.embedding.getEmbedding(newEpisodeText.slice(0, 2000)))
    const TOP_K_FETCH = 30
    const TOP_K_USE = 15
    const similarChunks = await abortableRace(abortSignal, this.vectorStore.searchSimilar(queryEmbedding, TOP_K_FETCH, workId))

    // 자기 자신 에피소드 청크 제외 (self-reference 환각 방지)
    const filteredChunks = similarChunks.filter((c) => c.episodeId !== excludeEpisodeId)

    if (filteredChunks.length === 0) {
      return analysisTypes.map((type) => ({
        type,
        score: 100,
        summary: '같은 작품에 비교할 다른 에피소드가 없어 분석을 건너뜁니다',
        issues: [],
        suggestions: [],
      }))
    }

    // 유사도 높은 청크들을 컨텍스트로 조합 — 에피소드 제목/화번호 라벨 부착
    const context = filteredChunks
      .sort((a, b) => a.distance - b.distance)
      .slice(0, TOP_K_USE)
      .map((c) => this.labelChunk(c, episodeTitleMap))
      .join('\n\n---\n\n')

    // 3종 분석 병렬 호출 (system prompt 캐싱 덕분에 중복 토큰 비용은 거의 없음)
    const ask = this.claude.ask.bind(this.claude)
    const episodeForAnalysis = newEpisodeText.slice(0, 3000)

    throwIfAborted(abortSignal)
    // signal을 checkXxx까지 그대로 전달 → Anthropic SDK messages.create의 RequestOptions.signal에 도달.
    // abort 시 fetch가 즉시 cancel되어 백그라운드 토큰 낭비 0건 (HARNESS §10 Phase 4 SDK signal 전파).
    const resultsRaw = await abortableRace(abortSignal, Promise.all(
      analysisTypes.map((type) => {
        if (type === 'consistency') return checkConsistency(ask, context, episodeForAnalysis, workMeta, abortSignal)
        if (type === 'tone') return checkTone(ask, context, episodeForAnalysis, workMeta, abortSignal)
        return checkCharacter(ask, context, episodeForAnalysis, workMeta, abortSignal)
      }),
    ))

    // 환각 검증: issues 각 항목의 인용이 실제 새 에피소드 텍스트에 존재하는지 확인
    return resultsRaw.map((r) => this.filterHallucinatedIssues(r, newEpisodeText))
  }

  /** 청크 라벨 생성 — Episode 제목을 알면 풍부하게, 아니면 episodeId만 */
  private labelChunk(
    c: { episodeId: string; chunkIndex: number; chunkText: string },
    meta: Map<string, { title: string; orderNum: number; type: string }>,
  ): string {
    const ep = meta.get(c.episodeId)
    const header = ep
      ? `[${this.formatEpisodeLabel(ep)} · 청크 ${c.chunkIndex}]`
      : `[기존 에피소드 ${c.episodeId} · 청크 ${c.chunkIndex}]`
    return `${header}\n${c.chunkText}`
  }

  private formatEpisodeLabel(ep: { title: string; orderNum: number; type: string }): string {
    if (ep.type === 'episode') return `제${ep.orderNum}화 "${ep.title}"`
    if (ep.type === 'preface') return `일러두기 "${ep.title}"`
    if (ep.type === 'afterword') return `후기 "${ep.title}"`
    if (ep.type === 'bonus') return `번외 "${ep.title}"`
    return `"${ep.title}"`
  }

  /**
   * 환각 방지 후처리 — issues 항목에 큰따옴표로 감싸인 인용이 있고,
   * 그 인용이 실제 새 에피소드 원문에 존재해야만 통과.
   * 인용이 없거나 원문에서 찾을 수 없으면 해당 issue를 제거.
   */
  private filterHallucinatedIssues(result: AnalysisResult, newEpisodeText: string): AnalysisResult {
    if (result.score === -1 || result.issues.length === 0) return result
    const normalized = newEpisodeText.replace(/\s+/g, ' ')
    const validated = result.issues.filter((issue) => {
      // "..." 8~40자 인용 찾기 (한글 큰따옴표 포함)
      const match = issue.match(/["""']([^"""']{4,40})["""']/)
      if (!match) {
        this.logger.warn(`issue에 인용 누락으로 제외: "${issue.slice(0, 40)}..."`)
        return false
      }
      const quote = match[1].replace(/\s+/g, ' ')
      // 8자 이상 중 앞 8자가 원문에 존재하면 통과 (인용 길이 유연 허용)
      const probe = quote.length >= 8 ? quote.slice(0, 8) : quote
      const found = normalized.includes(probe)
      if (!found) {
        this.logger.warn(`hallucination 감지로 제외: 인용 "${probe}" 원문에 없음`)
      }
      return found
    })
    return { ...result, issues: validated }
  }

  /** 작품의 인덱싱 상태 조회 */
  async getIndexStatus(workId: string): Promise<{ chunkCount: number; isIndexed: boolean }> {
    try {
      const count = await this.vectorStore.getChunkCount(workId)
      return { chunkCount: count, isIndexed: count > 0 }
    } catch {
      return { chunkCount: 0, isIndexed: false }
    }
  }
}
