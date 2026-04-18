import { NovelAnalysisUseCase } from './novel-analysis.usecase'

// chunkText 순수 함수를 모킹하여 테스트 격리
jest.mock('@lib/rag', () => ({
  chunkText: jest.fn(),
  checkConsistency: jest.fn(),
  checkTone: jest.fn(),
  checkCharacter: jest.fn(),
}))

import { chunkText, checkConsistency, checkTone, checkCharacter } from '@lib/rag'

const mockChunkText = chunkText as jest.MockedFunction<typeof chunkText>
const mockCheckConsistency = checkConsistency as jest.MockedFunction<typeof checkConsistency>
const mockCheckTone = checkTone as jest.MockedFunction<typeof checkTone>
const mockCheckCharacter = checkCharacter as jest.MockedFunction<typeof checkCharacter>

describe('NovelAnalysisUseCase', () => {
  let useCase: NovelAnalysisUseCase
  let mockVectorStore: {
    ensureTable: jest.Mock
    deleteByEpisode: jest.Mock
    insertChunk: jest.Mock
    searchSimilar: jest.Mock
    getChunkCount: jest.Mock
  }
  let mockEmbedding: {
    getEmbedding: jest.Mock
    getEmbeddingsBatch: jest.Mock
  }
  let mockClaude: { ask: jest.Mock; generateTheme: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    mockVectorStore = {
      ensureTable: jest.fn().mockResolvedValue(undefined),
      deleteByEpisode: jest.fn().mockResolvedValue(undefined),
      insertChunk: jest.fn().mockResolvedValue(undefined),
      searchSimilar: jest.fn(),
      getChunkCount: jest.fn(),
    }
    mockEmbedding = {
      getEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      getEmbeddingsBatch: jest.fn(),
    }
    mockClaude = {
      ask: jest.fn(),
      generateTheme: jest.fn(),
    }

    useCase = new NovelAnalysisUseCase(
      mockVectorStore as any,
      mockEmbedding as any,
      mockClaude as any,
    )
  })

  describe('indexEpisode', () => {
    it('텍스트를 청킹하고 벡터 DB에 저장한다', async () => {
      mockChunkText.mockReturnValue([
        { index: 0, text: '첫 번째 청크' },
        { index: 1, text: '두 번째 청크' },
      ])
      mockEmbedding.getEmbeddingsBatch.mockResolvedValue({
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
        tokensUsed: 50,
      })

      const result = await useCase.indexEpisode('ep-1', 'work-1', '소설 본문 텍스트')

      expect(mockVectorStore.ensureTable).toHaveBeenCalled()
      expect(mockVectorStore.deleteByEpisode).toHaveBeenCalledWith('ep-1')
      expect(mockChunkText).toHaveBeenCalledWith('소설 본문 텍스트')
      expect(mockEmbedding.getEmbeddingsBatch).toHaveBeenCalledWith(
        ['첫 번째 청크', '두 번째 청크'], 10,
      )
      expect(mockVectorStore.insertChunk).toHaveBeenCalledTimes(2)
      expect(mockVectorStore.insertChunk).toHaveBeenCalledWith(
        'ep-1_0', 'work-1', 'ep-1', 0, '첫 번째 청크', [0.1, 0.2],
      )
      expect(result).toEqual({ chunkCount: 2, tokensUsed: 50 })
    })

    it('빈 텍스트는 청크 0개를 반환한다', async () => {
      mockChunkText.mockReturnValue([])

      const result = await useCase.indexEpisode('ep-1', 'work-1', '')

      expect(result).toEqual({ chunkCount: 0, tokensUsed: 0 })
      expect(mockEmbedding.getEmbeddingsBatch).not.toHaveBeenCalled()
      expect(mockVectorStore.insertChunk).not.toHaveBeenCalled()
    })
  })

  describe('analyzeNewEpisode', () => {
    it('기존 컨텍스트가 없으면 비교 불가 결과를 반환한다', async () => {
      mockVectorStore.searchSimilar.mockResolvedValue([])

      const results = await useCase.analyzeNewEpisode('work-1', '새 에피소드 텍스트')

      expect(results).toHaveLength(3)
      results.forEach((r) => {
        expect(r.score).toBe(100)
        expect(r.summary).toContain('비교할 기존 에피소드가 없')
        expect(r.issues).toEqual([])
      })
    })

    it('excludeEpisodeId 지정 시 자기 자신 청크를 컨텍스트에서 제외한다', async () => {
      // 같은 workId 내 2개 에피소드 청크가 검색됨 — 하나는 제외 대상
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: 'ep-9_0', workId: 'work-1', episodeId: 'ep-9', chunkIndex: 0, chunkText: '자기 자신 청크 내용', distance: 0.1 },
        { id: 'ep-5_2', workId: 'work-1', episodeId: 'ep-5', chunkIndex: 2, chunkText: '다른 에피소드 청크 내용', distance: 0.3 },
      ] as any)
      mockEmbedding.getEmbedding.mockResolvedValue([0.1])
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: 90, summary: 'ok', issues: [], suggestions: [],
      })

      await useCase.analyzeNewEpisode('work-1', '새 에피소드 텍스트', ['consistency'], 'ep-9')

      // checkConsistency에 전달된 context를 검증 — ep-9 청크는 제외되어야 함
      expect(mockCheckConsistency).toHaveBeenCalledTimes(1)
      const context = mockCheckConsistency.mock.calls[0][1] as string
      expect(context).toContain('ep-5')
      expect(context).not.toContain('자기 자신 청크 내용')
      expect(context).toContain('다른 에피소드 청크 내용')
      // 라벨 프리픽스 확인
      expect(context).toContain('[기존 에피소드 ep-5')
    })

    it('유사 청크가 있으면 분석을 수행한다', async () => {
      mockVectorStore.searchSimilar.mockResolvedValue([
        { chunkText: '기존 청크 1', distance: 0.1 },
        { chunkText: '기존 청크 2', distance: 0.3 },
      ])
      const mockResult = {
        type: 'consistency' as const,
        score: 85,
        summary: '대체로 일관됨',
        issues: ['사소한 시간대 불일치'],
        suggestions: ['2장의 시간대를 확인하세요'],
      }
      mockCheckConsistency.mockResolvedValue(mockResult)
      mockCheckTone.mockResolvedValue({ ...mockResult, type: 'tone' as const })
      mockCheckCharacter.mockResolvedValue({ ...mockResult, type: 'character' as const })

      const results = await useCase.analyzeNewEpisode('work-1', '새 에피소드 텍스트')

      expect(mockEmbedding.getEmbedding).toHaveBeenCalled()
      expect(mockVectorStore.searchSimilar).toHaveBeenCalledWith(
        [0.1, 0.2, 0.3], 20, 'work-1',
      )
      expect(results).toHaveLength(3)
      expect(results[0].type).toBe('consistency')
    })

    it('특정 분석 타입만 요청할 수 있다', async () => {
      mockVectorStore.searchSimilar.mockResolvedValue([
        { chunkText: '청크', distance: 0.2 },
      ])
      mockCheckTone.mockResolvedValue({
        type: 'tone' as const,
        score: 90,
        summary: '톤 분석 결과',
        issues: [],
        suggestions: [],
      })

      const results = await useCase.analyzeNewEpisode('work-1', '새 텍스트', ['tone'])

      expect(mockCheckTone).toHaveBeenCalled()
      expect(mockCheckConsistency).not.toHaveBeenCalled()
      expect(mockCheckCharacter).not.toHaveBeenCalled()
      expect(results).toHaveLength(1)
      expect(results[0].type).toBe('tone')
    })
  })

  describe('getIndexStatus', () => {
    it('작품의 청크 수를 반환한다', async () => {
      mockVectorStore.getChunkCount.mockResolvedValue(15)

      const result = await useCase.getIndexStatus('work-1')

      expect(mockVectorStore.getChunkCount).toHaveBeenCalledWith('work-1')
      expect(result).toEqual({ chunkCount: 15, isIndexed: true })
    })

    it('인덱싱되지 않은 작품은 0을 반환한다', async () => {
      mockVectorStore.getChunkCount.mockResolvedValue(0)

      const result = await useCase.getIndexStatus('work-1')

      expect(result).toEqual({ chunkCount: 0, isIndexed: false })
    })

    it('벡터 DB 에러 시 안전하게 0을 반환한다', async () => {
      mockVectorStore.getChunkCount.mockRejectedValue(new Error('DB 연결 실패'))

      const result = await useCase.getIndexStatus('work-1')

      expect(result).toEqual({ chunkCount: 0, isIndexed: false })
    })
  })
})
