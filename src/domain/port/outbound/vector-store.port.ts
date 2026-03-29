/** 벡터 저장소 포트 — 소설 청크 벡터 DB */
export interface ChunkResult {
  id: string
  workId: string
  episodeId: string
  chunkIndex: number
  chunkText: string
  distance: number
}

export interface VectorStorePort {
  /** 벡터 테이블 초기화 (없으면 생성) */
  ensureTable(): Promise<void>

  /** 청크 삽입 (upsert) */
  insertChunk(
    id: string,
    workId: string,
    episodeId: string,
    chunkIndex: number,
    chunkText: string,
    embedding: number[],
  ): Promise<void>

  /** 유사 청크 검색 (코사인 거리) */
  searchSimilar(
    queryEmbedding: number[],
    topK: number,
    workId?: string,
  ): Promise<ChunkResult[]>

  /** 작품의 모든 청크 삭제 */
  deleteByWork(workId: string): Promise<void>

  /** 에피소드의 모든 청크 삭제 */
  deleteByEpisode(episodeId: string): Promise<void>

  /** 작품의 청크 수 조회 */
  getChunkCount(workId: string): Promise<number>
}
