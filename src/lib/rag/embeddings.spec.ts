import { getEmbedding, getEmbeddingsBatch, EMBEDDING_DIM } from './embeddings'

// OpenAI API 모킹
const mockFetch = jest.fn()
global.fetch = mockFetch as any

describe('embeddings', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key'
    mockFetch.mockReset()
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

    const result = await getEmbedding('테스트 텍스트')
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

    const result = await getEmbeddingsBatch(['텍스트1', '텍스트2'], 2)
    expect(result.embeddings).toHaveLength(2)
    expect(result.tokensUsed).toBe(20)
  })

  it('API 키 없으면 에러를 던진다', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_KEY
    await expect(getEmbedding('test')).rejects.toThrow('OPENAI_API_KEY')
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

    const result = await getEmbedding('test')
    expect(result).toHaveLength(EMBEDDING_DIM)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  }, 15000)
})
