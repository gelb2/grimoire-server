/**
 * pgvector 벡터 DB 모듈 (YECHANGPE에서 이식)
 * 소설 도메인: novel_chunks 테이블 사용
 */

import { PrismaService } from '@infrastructure/prisma/prisma.service'

const HNSW_THRESHOLD = 10_000

/** pgvector 확장 + novel_chunks 테이블 생성 */
export async function ensureVectorTable(prisma: PrismaService) {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector')
  await prisma.$executeRawUnsafe(`
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
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS idx_novel_chunks_work ON novel_chunks (work_id)')
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS idx_novel_chunks_episode ON novel_chunks (episode_id)')
  } catch (error) {
    console.warn('[vector-db] 인덱스 생성 경고:', error)
  }
  await ensureHnswIndex(prisma)
}

/** HNSW 인덱스 생성 (청크 수 기반 자동 판단) */
export async function ensureHnswIndex(prisma: PrismaService) {
  const result = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>('SELECT COUNT(*) as cnt FROM novel_chunks')
  const totalChunks = Number(result[0]?.cnt ?? 0)

  if (totalChunks >= HNSW_THRESHOLD) {
    try {
      await prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS idx_novel_chunks_hnsw ON novel_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
      )
    } catch (error) {
      console.warn('[vector-db] HNSW 인덱스 생성 경고:', error)
    }
  }
}

/** 청크 삽입 (upsert) */
export async function insertChunk(
  prisma: PrismaService,
  id: string,
  workId: string,
  episodeId: string,
  chunkIndex: number,
  chunkText: string,
  embedding: number[],
) {
  const embeddingStr = `[${embedding.join(',')}]`
  await prisma.$executeRawUnsafe(
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

/** 유사 청크 검색 (코사인 거리) */
export async function searchSimilarChunks(
  prisma: PrismaService,
  queryEmbedding: number[],
  topK: number = 30,
  workId?: string,
): Promise<{ id: string; workId: string; episodeId: string; chunkIndex: number; chunkText: string; distance: number }[]> {
  try {
    const embeddingStr = `[${queryEmbedding.join(',')}]`

    const countResult = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>('SELECT COUNT(*) as cnt FROM novel_chunks')
    const totalChunks = Number(countResult[0]?.cnt ?? 0)

    // 작품 필터가 있으면 해당 작품만 검색
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
      result = await prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_indexscan = off')
        return tx.$queryRawUnsafe(query, ...params)
      })
    } else {
      result = await prisma.$queryRawUnsafe(query, ...params)
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
    console.error('[vector-db] searchSimilarChunks 오류:', error)
    return []
  }
}

/** 작품의 모든 청크 삭제 */
export async function deleteChunksByWork(prisma: PrismaService, workId: string) {
  await prisma.$executeRawUnsafe('DELETE FROM novel_chunks WHERE work_id = $1', workId)
}

/** 에피소드의 모든 청크 삭제 */
export async function deleteChunksByEpisode(prisma: PrismaService, episodeId: string) {
  await prisma.$executeRawUnsafe('DELETE FROM novel_chunks WHERE episode_id = $1', episodeId)
}

/** 작품의 청크 수 조회 */
export async function getChunkCountByWork(prisma: PrismaService, workId: string): Promise<number> {
  const result = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
    'SELECT COUNT(*) as cnt FROM novel_chunks WHERE work_id = $1', workId,
  )
  return Number(result[0]?.cnt ?? 0)
}
