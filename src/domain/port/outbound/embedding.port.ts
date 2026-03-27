/** 임베딩 생성 포트 — 벡터 검색용 텍스트 임베딩 */
export interface EmbeddingPort {
  /** 단일 텍스트 임베딩 생성 */
  getEmbedding(text: string): Promise<number[]>

  /** 배치 임베딩 생성 */
  getEmbeddingsBatch(
    texts: string[],
    batchSize?: number,
  ): Promise<{ embeddings: number[][]; tokensUsed: number }>
}
