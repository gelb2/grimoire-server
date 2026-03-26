import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { chunkText, getEmbedding, getEmbeddingsBatch, insertChunk, searchSimilarChunks, deleteChunksByEpisode, ensureVectorTable, getChunkCountByWork } from '@lib/rag'
import { checkConsistency, checkTone, checkCharacter, AnalysisResult } from '@lib/rag'

@Injectable()
export class NovelAnalysisUseCase {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /** 에피소드 텍스트를 벡터화하여 인덱싱 */
  async indexEpisode(episodeId: string, workId: string, rawText: string): Promise<{ chunkCount: number; tokensUsed: number }> {
    await ensureVectorTable(this.prisma)

    // 기존 청크 삭제 (재인덱싱)
    await deleteChunksByEpisode(this.prisma, episodeId)

    // 텍스트 청킹
    const chunks = chunkText(rawText)
    if (chunks.length === 0) return { chunkCount: 0, tokensUsed: 0 }

    // 배치 임베딩 생성
    const { embeddings, tokensUsed } = await getEmbeddingsBatch(
      chunks.map((c) => c.text),
      10,
    )

    // 벡터 DB에 저장
    for (let i = 0; i < chunks.length; i++) {
      await insertChunk(
        this.prisma,
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

  /** 새 에피소드와 기존 작품의 일관성 분석 (RAG) */
  async analyzeNewEpisode(
    workId: string,
    newEpisodeText: string,
    analysisTypes: ('consistency' | 'tone' | 'character')[] = ['consistency', 'tone', 'character'],
  ): Promise<AnalysisResult[]> {
    // 기존 작품의 컨텍스트 검색
    const queryEmbedding = await getEmbedding(newEpisodeText.slice(0, 2000))
    const similarChunks = await searchSimilarChunks(this.prisma, queryEmbedding, 20, workId)

    if (similarChunks.length === 0) {
      return analysisTypes.map((type) => ({
        type,
        score: 100,
        summary: '기존 에피소드가 없어 비교 불가 — 첫 에피소드입니다',
        issues: [],
        suggestions: [],
      }))
    }

    // 유사도 높은 청크들을 컨텍스트로 조합
    const context = similarChunks
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 15)
      .map((c) => c.chunkText)
      .join('\n\n---\n\n')

    // 요청된 분석 타입별 실행
    const results: AnalysisResult[] = []

    for (const type of analysisTypes) {
      if (type === 'consistency') results.push(await checkConsistency(context, newEpisodeText.slice(0, 3000)))
      if (type === 'tone') results.push(await checkTone(context, newEpisodeText.slice(0, 3000)))
      if (type === 'character') results.push(await checkCharacter(context, newEpisodeText.slice(0, 3000)))
    }

    return results
  }

  /** 작품의 인덱싱 상태 조회 */
  async getIndexStatus(workId: string): Promise<{ chunkCount: number; isIndexed: boolean }> {
    try {
      const count = await getChunkCountByWork(this.prisma, workId)
      return { chunkCount: count, isIndexed: count > 0 }
    } catch {
      return { chunkCount: 0, isIndexed: false }
    }
  }
}
