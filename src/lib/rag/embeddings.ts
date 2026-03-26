/**
 * OpenAI 임베딩 생성 모듈 (YECHANGPE에서 이식)
 * text-embedding-3-small 모델 사용 (1536 차원)
 */

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIM = 1536
const DEFAULT_BATCH_SIZE = 100

interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[]
  usage: { prompt_tokens: number; total_tokens: number }
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY
  if (!key) throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다')
  return key
}

async function callEmbeddingAPI(texts: string[]): Promise<{ embeddings: number[][]; tokensUsed: number }> {
  const apiKey = getApiKey()

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
        dimensions: EMBEDDING_DIM,
      }),
    })

    if (response.ok) {
      const data: EmbeddingResponse = await response.json()
      const sorted = data.data.sort((a, b) => a.index - b.index)
      return {
        embeddings: sorted.map((d) => d.embedding),
        tokensUsed: data.usage.total_tokens,
      }
    }

    if (response.status === 429 && attempt < 2) {
      const waitSec = (attempt + 1) * 5
      console.warn(`[embeddings] rate limited (429), ${waitSec}초 대기... (attempt ${attempt + 1}/3)`)
      await new Promise((r) => setTimeout(r, waitSec * 1000))
      continue
    }

    const error = await response.text()
    throw new Error(`OpenAI Embedding API 오류: ${response.status} ${error}`)
  }

  throw new Error('OpenAI Embedding API: 재시도 횟수 초과')
}

/** 단일 텍스트 임베딩 생성 */
export async function getEmbedding(text: string): Promise<number[]> {
  const { embeddings } = await callEmbeddingAPI([text])
  return embeddings[0]
}

/** 배치 임베딩 생성 */
export async function getEmbeddingsBatch(
  texts: string[],
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<{ embeddings: number[][]; tokensUsed: number }> {
  const allEmbeddings: number[][] = []
  let totalTokens = 0

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const { embeddings, tokensUsed } = await callEmbeddingAPI(batch)
    allEmbeddings.push(...embeddings)
    totalTokens += tokensUsed
  }

  return { embeddings: allEmbeddings, tokensUsed: totalTokens }
}
