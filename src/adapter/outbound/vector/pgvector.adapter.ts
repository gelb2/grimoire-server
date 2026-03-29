import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { VectorStorePort, ChunkResult } from '@domain/port/outbound/vector-store.port'

const HNSW_THRESHOLD = 10_000

/** pgvector 기반 벡터 저장소 어댑터 */
@Injectable()
export class PgVectorAdapter implements VectorStorePort {
  private readonly logger = new Logger(PgVectorAdapter.name)

  constructor(private readonly prisma: PrismaService) {}

  async ensureTable(): Promise<void> {
    await this.prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector')
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS novel_chunks (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        embedding vector(1536)
      )
    `)
    try {
      await this.prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS idx_novel_chunks_work ON novel_chunks (work_id)')
      await this.prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS idx_novel_chunks_episode ON novel_chunks (episode_id)')
    } catch (error) {
      this.logger.warn('인덱스 생성 경고:', error)
    }
    await this.ensureHnswIndex()
  }

  async insertChunk(
    id: string,
    workId: string,
    episodeId: string,
    chunkIndex: number,
    chunkText: string,
    embedding: number[],
  ): Promise<void> {
    const embeddingStr = `[${embedding.join(',')}]`
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO novel_chunks (id, work_id, episode_id, chunk_index, chunk_text, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)
       ON CONFLICT (id) DO UPDATE SET
         work_id = EXCLUDED.work_id,
         episode_id = EXCLUDED.episode_id,
         chunk_index = EXCLUDED.chunk_index,
         chunk_text = EXCLUDED.chunk_text,
         embedding = EXCLUDED.embedding`,
      id, workId, episodeId, chunkIndex, chunkText, embeddingStr,
    )
  }

  async searchSimilar(
    queryEmbedding: number[],
    topK: number = 30,
    workId?: string,
  ): Promise<ChunkResult[]> {
    try {
      const embeddingStr = `[${queryEmbedding.join(',')}]`

      const countResult = await this.prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
        'SELECT COUNT(*) as cnt FROM novel_chunks',
      )
      const totalChunks = Number(countResult[0]?.cnt ?? 0)

      const whereClause = workId ? 'WHERE work_id = $3' : ''
      const params = workId ? [embeddingStr, topK, workId] : [embeddingStr, topK]

      const query = `
        SELECT id, work_id, episode_id, chunk_index, chunk_text,
               (embedding <=> $1::vector) as distance
        FROM novel_chunks
        ${whereClause}
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `

      let result
      if (totalChunks < HNSW_THRESHOLD) {
        result = await this.prisma.$transaction(async (tx: any) => {
          await tx.$executeRawUnsafe('SET LOCAL enable_indexscan = off')
          return tx.$queryRawUnsafe(query, ...params)
        })
      } else {
        result = await this.prisma.$queryRawUnsafe(query, ...params)
      }

      return (result as any[]).map((row: any) => ({
        id: row.id,
        workId: row.work_id,
        episodeId: row.episode_id,
        chunkIndex: row.chunk_index,
        chunkText: row.chunk_text,
        distance: row.distance,
      }))
    } catch (error) {
      this.logger.error('searchSimilar 오류:', error)
      return []
    }
  }

  async deleteByWork(workId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe('DELETE FROM novel_chunks WHERE work_id = $1', workId)
  }

  async deleteByEpisode(episodeId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe('DELETE FROM novel_chunks WHERE episode_id = $1', episodeId)
  }

  async getChunkCount(workId: string): Promise<number> {
    const result = await this.prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
      'SELECT COUNT(*) as cnt FROM novel_chunks WHERE work_id = $1', workId,
    )
    return Number(result[0]?.cnt ?? 0)
  }

  private async ensureHnswIndex(): Promise<void> {
    const result = await this.prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
      'SELECT COUNT(*) as cnt FROM novel_chunks',
    )
    const totalChunks = Number(result[0]?.cnt ?? 0)

    if (totalChunks >= HNSW_THRESHOLD) {
      try {
        await this.prisma.$executeRawUnsafe(
          'CREATE INDEX IF NOT EXISTS idx_novel_chunks_hnsw ON novel_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
        )
      } catch (error) {
        this.logger.warn('HNSW 인덱스 생성 경고:', error)
      }
    }
  }
}
