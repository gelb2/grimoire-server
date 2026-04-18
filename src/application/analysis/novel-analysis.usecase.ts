import { Injectable, Inject, Logger } from '@nestjs/common'
import { VectorStorePort } from '@domain/port/outbound/vector-store.port'
import { EmbeddingPort } from '@domain/port/outbound/embedding.port'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { chunkText, checkConsistency, checkTone, checkCharacter, AnalysisResult, WorkMeta } from '@lib/rag'

@Injectable()
export class NovelAnalysisUseCase {
  private readonly logger = new Logger(NovelAnalysisUseCase.name)

  constructor(
    @Inject('VectorStorePort') private readonly vectorStore: VectorStorePort,
    @Inject('EmbeddingPort') private readonly embedding: EmbeddingPort,
    @Inject('ClaudeApiPort') private readonly claude: ClaudeApiPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
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
   * 새 에피소드와 기존 작품의 일관성 분석 (RAG)
   *
   * Claude Projects 스타일 강화:
   * - Work 메타(title/context/instructions) 로드 → 시스템 프롬프트 동적 주입
   * - 에피소드 제목을 컨텍스트 라벨에 포함 (`[제9화 "도리안그레이의 초상" · 청크 3]`)
   * - 3종 분석을 Promise.all 병렬 호출 (latency 1/3)
   * - 응답의 issues 인용이 실제 새 에피소드 텍스트에 존재하는지 후처리 검증 (환각 제거)
   *
   * 파라미터:
   * - excludeEpisodeId — 재분석 시 자기 자신 청크 제외 (self-reference 방지)
   */
  async analyzeNewEpisode(
    workId: string,
    newEpisodeText: string,
    analysisTypes: ('consistency' | 'tone' | 'character')[] = ['consistency', 'tone', 'character'],
    excludeEpisodeId?: string,
  ): Promise<AnalysisResult[]> {
    // 작품 메타 + 에피소드 제목 매핑 병렬 로드
    const [work, episodeSummaries] = await Promise.all([
      this.workRepo.findById(workId).catch(() => null),
      this.workRepo.findEpisodes(workId).catch(() => []),
    ])
    const workMeta: WorkMeta | undefined = work
      ? { title: work.title, context: work.context, instructions: work.instructions }
      : undefined
    const episodeTitleMap = new Map<string, { title: string; orderNum: number; type: string }>()
    for (const ep of episodeSummaries) {
      episodeTitleMap.set(ep.id, { title: ep.title, orderNum: ep.orderNum, type: ep.type })
    }

    // 기존 작품의 컨텍스트 검색 (self-reference 가능성 대비 검색량 늘림)
    const queryEmbedding = await this.embedding.getEmbedding(newEpisodeText.slice(0, 2000))
    const TOP_K_FETCH = excludeEpisodeId ? 30 : 20
    const TOP_K_USE = 15
    const similarChunks = await this.vectorStore.searchSimilar(queryEmbedding, TOP_K_FETCH, workId)

    // 자기 자신 에피소드 청크 제외 (재분석 시 환각 방지)
    const filteredChunks = excludeEpisodeId
      ? similarChunks.filter((c) => c.episodeId !== excludeEpisodeId)
      : similarChunks

    if (filteredChunks.length === 0) {
      return analysisTypes.map((type) => ({
        type,
        score: 100,
        summary: '비교할 기존 에피소드가 없어 분석을 건너뜁니다',
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

    const resultsRaw = await Promise.all(
      analysisTypes.map((type) => {
        if (type === 'consistency') return checkConsistency(ask, context, episodeForAnalysis, workMeta)
        if (type === 'tone') return checkTone(ask, context, episodeForAnalysis, workMeta)
        return checkCharacter(ask, context, episodeForAnalysis, workMeta)
      }),
    )

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
