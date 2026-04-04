import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { Injectable } from '@nestjs/common'

export interface CacheEntry {
  id: string
  cacheType: string
  queryText: string
  responseJson: any
  hitCount: number
}

/**
 * 시맨틱 캐싱 — 임베딩 유사도 기반
 * 분석/테마/채팅 응답을 캐싱하여 동일/유사 요청 시 API 호출 절약
 */
@Injectable()
export class SemanticCacheService {
  constructor(private readonly prisma: PrismaService) {}

  /** 테이블 생성 (최초 1회) */
  async ensureTable(): Promise<void> {
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS semantic_cache (
        id TEXT PRIMARY KEY,
        cache_type TEXT NOT NULL,
        query_text TEXT NOT NULL,
        query_embedding vector(1536),
        response_json JSONB NOT NULL,
        work_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        hit_count INTEGER DEFAULT 0
      )
    `
    await this.prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_semantic_cache_type ON semantic_cache (cache_type)
    `
  }

  /** 캐시 검색 — 유사도 threshold 이상이면 히트 */
  async search(
    embedding: number[],
    cacheType: string,
    threshold: number = 0.95,
    workId?: string,
  ): Promise<CacheEntry | null> {
    const vectorStr = `[${embedding.join(',')}]`
    const where = workId
      ? `cache_type = '${cacheType}' AND work_id = '${workId}'`
      : `cache_type = '${cacheType}'`

    const results: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT id, cache_type, query_text, response_json, hit_count,
             1 - (query_embedding <=> '${vectorStr}'::vector) as similarity
      FROM semantic_cache
      WHERE ${where}
      ORDER BY query_embedding <=> '${vectorStr}'::vector
      LIMIT 1
    `)

    if (results.length === 0) return null
    const best = results[0]
    if (best.similarity < threshold) return null

    // 히트 카운트 증가
    await this.prisma.$executeRawUnsafe(
      `UPDATE semantic_cache SET hit_count = hit_count + 1 WHERE id = $1`,
      best.id,
    )

    return {
      id: best.id,
      cacheType: best.cache_type,
      queryText: best.query_text,
      responseJson: best.response_json,
      hitCount: best.hit_count + 1,
    }
  }

  /** 캐시 저장 */
  async store(
    id: string,
    cacheType: string,
    queryText: string,
    embedding: number[],
    responseJson: any,
    workId?: string,
  ): Promise<void> {
    const vectorStr = `[${embedding.join(',')}]`
    await this.prisma.$executeRawUnsafe(`
      INSERT INTO semantic_cache (id, cache_type, query_text, query_embedding, response_json, work_id)
      VALUES ($1, $2, $3, '${vectorStr}'::vector, $4::jsonb, $5)
      ON CONFLICT (id) DO UPDATE SET
        response_json = EXCLUDED.response_json,
        query_embedding = EXCLUDED.query_embedding
    `, id, cacheType, queryText, JSON.stringify(responseJson), workId ?? null)
  }

  /** 특정 작품의 캐시 무효화 */
  async invalidateByWork(workId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM semantic_cache WHERE work_id = $1`,
      workId,
    )
  }

  /** 오래된 캐시 정리 (30일 초과) */
  async cleanup(days: number = 30): Promise<number> {
    const result: any[] = await this.prisma.$queryRawUnsafe(`
      DELETE FROM semantic_cache WHERE created_at < NOW() - INTERVAL '${days} days'
      RETURNING id
    `)
    return result.length
  }
}
