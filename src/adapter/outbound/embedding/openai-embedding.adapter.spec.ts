import { OpenAIEmbeddingAdapter } from './openai-embedding.adapter'

const EMBEDDING_DIM = 1536

const mockFetch = jest.fn()
global.fetch = mockFetch as any

describe('OpenAIEmbeddingAdapter', () => {
  let adapter: OpenAIEmbeddingAdapter

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key'
    mockFetch.mockReset()
    adapter = new OpenAIEmbeddingAdapter()
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  it('단일 텍스트 임베딩을 생성한다', async () => {
    const mockEmbedding = Array(EMBEDDING_DIM).fill(0.1)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: mockEmbedding, index: 0 }],
        usage: { prompt_tokens: 10, total_tokens: 10 },
      }),
    })

    const result = await adapter.getEmbedding('테스트 텍스트')
    expect(result).toHaveLength(EMBEDDING_DIM)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('배치 임베딩을 생성한다', async () => {
    const mockEmbedding = Array(EMBEDDING_DIM).fill(0.1)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: mockEmbedding, index: 0 },
          { embedding: mockEmbedding, index: 1 },
        ],
        usage: { prompt_tokens: 20, total_tokens: 20 },
      }),
    })

    const result = await adapter.getEmbeddingsBatch(['텍스트1', '텍스트2'], 2)
    expect(result.embeddings).toHaveLength(2)
    expect(result.tokensUsed).toBe(20)
  })

  it('API 키 없으면 에러를 던진다', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_KEY
    await expect(adapter.getEmbedding('test')).rejects.toThrow('OPENAI_API_KEY')
  })

  it('429 에러 시 재시도한다', async () => {
    const mockEmbedding = Array(EMBEDDING_DIM).fill(0.1)
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: mockEmbedding, index: 0 }],
          usage: { prompt_tokens: 10, total_tokens: 10 },
        }),
      })

    const result = await adapter.getEmbedding('test')
    expect(result).toHaveLength(EMBEDDING_DIM)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  }, 15000)
})
