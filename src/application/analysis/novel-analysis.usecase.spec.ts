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
  let mockWorkRepo: { findById: jest.Mock; findEpisodes: jest.Mock }
  let mockCreditRepo: {
    adjustCredits: jest.Mock
    findLogsByAuthorId: jest.Mock
    giftTransfer: jest.Mock
    getGiftRanking: jest.Mock
    sumNegativeAmounts: jest.Mock
  }

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
    mockWorkRepo = {
      findById: jest.fn().mockResolvedValue(null),
      findEpisodes: jest.fn().mockResolvedValue([]),
    }
    mockCreditRepo = {
      adjustCredits: jest.fn().mockResolvedValue({ credits: 10, log: {} }),
      findLogsByAuthorId: jest.fn().mockResolvedValue([]),
      giftTransfer: jest.fn(),
      getGiftRanking: jest.fn().mockResolvedValue([]),
      sumNegativeAmounts: jest.fn().mockResolvedValue(0),
    }

    useCase = new NovelAnalysisUseCase(
      mockVectorStore as any,
      mockEmbedding as any,
      mockClaude as any,
      mockWorkRepo as any,
      mockCreditRepo as any,
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

      const results = await useCase.analyzeNewEpisode('author-1', 'work-1', '새 에피소드 텍스트')

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

      await useCase.analyzeNewEpisode('author-1', 'work-1', '새 에피소드 텍스트', ['consistency'], 'ep-9')

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

      const results = await useCase.analyzeNewEpisode('author-1', 'work-1', '새 에피소드 텍스트')

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

      const results = await useCase.analyzeNewEpisode('author-1', 'work-1', '새 텍스트', ['tone'])

      expect(mockCheckTone).toHaveBeenCalled()
      expect(mockCheckConsistency).not.toHaveBeenCalled()
      expect(mockCheckCharacter).not.toHaveBeenCalled()
      expect(results).toHaveLength(1)
      expect(results[0].type).toBe('tone')
    })

    it('Work 메타(context/instructions)가 분석 함수에 전달된다', async () => {
      mockWorkRepo.findById.mockResolvedValue({
        id: 'work-1', title: '사슴악마', context: '현대 판타지', instructions: '느와르 톤',
      })
      mockVectorStore.searchSimilar.mockResolvedValue([
        { chunkText: '청크', episodeId: 'ep-1', chunkIndex: 0, distance: 0.1 },
      ])
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: 90, summary: 'ok', issues: [], suggestions: [],
      })

      await useCase.analyzeNewEpisode('author-1', 'work-1', '새 텍스트', ['consistency'])

      const workMetaArg = mockCheckConsistency.mock.calls[0][3]
      expect(workMetaArg).toEqual({
        title: '사슴악마', context: '현대 판타지', instructions: '느와르 톤',
      })
    })

    it('에피소드 제목을 컨텍스트 라벨에 포함한다', async () => {
      mockWorkRepo.findEpisodes.mockResolvedValue([
        { id: 'ep-9', title: '도리안그레이의 초상', orderNum: 9, type: 'episode' },
      ])
      mockVectorStore.searchSimilar.mockResolvedValue([
        { chunkText: '청크내용', episodeId: 'ep-9', chunkIndex: 2, distance: 0.1 },
      ])
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: 90, summary: 'ok', issues: [], suggestions: [],
      })

      await useCase.analyzeNewEpisode('author-1', 'work-1', '새 텍스트', ['consistency'])

      const context = mockCheckConsistency.mock.calls[0][1] as string
      expect(context).toContain('제9화 "도리안그레이의 초상"')
      expect(context).toContain('청크 2')
    })

    it('환각 검증 — 원문에 없는 인용은 issues에서 제거된다', async () => {
      mockVectorStore.searchSimilar.mockResolvedValue([
        { chunkText: '청크', episodeId: 'ep-1', chunkIndex: 0, distance: 0.1 },
      ])
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: 80, summary: '이슈 있음',
        issues: [
          '설정 충돌 — "원문에 있는 구절"',  // 통과 (아래 newText에 포함)
          '허위 인용 — "존재하지 않는 내용"',  // 제외 (newText에 없음)
          '인용 누락 issue',                // 제외 (따옴표 인용 없음)
        ],
        suggestions: [],
      })

      const newText = '새 에피소드 텍스트입니다. 원문에 있는 구절 이 여기 들어있어요.'
      const results = await useCase.analyzeNewEpisode('author-1', 'work-1', newText, ['consistency'])

      expect(results[0].issues).toHaveLength(1)
      expect(results[0].issues[0]).toContain('원문에 있는 구절')
    })

    it('분석 실패(score=-1) 결과는 환각 검증에서 손대지 않는다', async () => {
      mockVectorStore.searchSimilar.mockResolvedValue([
        { chunkText: '청크', episodeId: 'ep-1', chunkIndex: 0, distance: 0.1 },
      ])
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: -1, summary: '분석 실패 (AI 호출 오류)',
        issues: [], suggestions: [],
      })

      const results = await useCase.analyzeNewEpisode('author-1', 'work-1', '아무 텍스트', ['consistency'])

      expect(results[0].score).toBe(-1)
      expect(results[0].summary).toContain('분석 실패')
    })

    // F2 2026-04-19: AI 분석 3 크레딧 차감
    describe('크레딧 차감 (F2)', () => {
      it('분석 시작 전 3 크레딧을 차감한다', async () => {
        mockVectorStore.searchSimilar.mockResolvedValue([])
        await useCase.analyzeNewEpisode('author-1', 'work-1', '새 텍스트')

        expect(mockCreditRepo.adjustCredits).toHaveBeenCalledWith(
          'author-1', -3, 'novel_analysis',
        )
      })

      it('크레딧 부족 시 BadRequest를 던지고 분석을 수행하지 않는다', async () => {
        mockCreditRepo.adjustCredits.mockRejectedValueOnce(new Error('크레딧이 부족합니다'))

        await expect(
          useCase.analyzeNewEpisode('author-1', 'work-1', '새 텍스트'),
        ).rejects.toThrow('AI 분석은 3 크레딧이 필요합니다')

        expect(mockVectorStore.searchSimilar).not.toHaveBeenCalled()
        expect(mockCheckConsistency).not.toHaveBeenCalled()
      })

      it('분석 중 예외가 나면 전액(3) 환불한다', async () => {
        mockVectorStore.searchSimilar.mockRejectedValue(new Error('벡터 DB 장애'))

        await expect(
          useCase.analyzeNewEpisode('author-1', 'work-1', '새 텍스트'),
        ).rejects.toThrow('벡터 DB 장애')

        // 차감(-3)과 환불(+3)이 각각 호출됐는지
        expect(mockCreditRepo.adjustCredits).toHaveBeenNthCalledWith(1, 'author-1', -3, 'novel_analysis')
        expect(mockCreditRepo.adjustCredits).toHaveBeenNthCalledWith(2, 'author-1', 3, 'novel_analysis_refund')
      })
    })

    // 2026-04-19 P0: 클라이언트 HTTP disconnect 대응 — AbortSignal 기반 중단 + 환불 보장
    describe('AbortSignal 기반 클라이언트 disconnect 대응', () => {
      it('이미 aborted된 signal이 오면 즉시 AbortedError로 중단하고 환불한다', async () => {
        const controller = new AbortController()
        controller.abort()

        await expect(
          useCase.analyzeNewEpisode('author-1', 'work-1', '새 텍스트', undefined, undefined, controller.signal),
        ).rejects.toThrow(/중단/)

        // 차감 후 runAnalysis 진입 즉시 throwIfAborted → catch → 환불
        expect(mockCreditRepo.adjustCredits).toHaveBeenNthCalledWith(1, 'author-1', -3, 'novel_analysis')
        expect(mockCreditRepo.adjustCredits).toHaveBeenNthCalledWith(2, 'author-1', 3, 'novel_analysis_refund')
        // 실제 분석은 시작도 안 함
        expect(mockVectorStore.searchSimilar).not.toHaveBeenCalled()
        expect(mockCheckConsistency).not.toHaveBeenCalled()
      })

      it('첫 workRepo 조회 진행 중 abort되면 AbortedError + 환불', async () => {
        const controller = new AbortController()
        // workRepo가 무한 대기하도록 설정 → abort로만 중단 가능
        mockWorkRepo.findById.mockImplementation(() => new Promise(() => {}))
        mockWorkRepo.findEpisodes.mockImplementation(() => new Promise(() => {}))

        const promise = useCase.analyzeNewEpisode(
          'author-1', 'work-1', '새 텍스트', undefined, undefined, controller.signal,
        )
        // 다음 tick에 abort
        await new Promise((r) => setImmediate(r))
        controller.abort()

        await expect(promise).rejects.toThrow(/중단/)

        // 차감 + 환불 양쪽 호출 확인
        expect(mockCreditRepo.adjustCredits).toHaveBeenNthCalledWith(1, 'author-1', -3, 'novel_analysis')
        expect(mockCreditRepo.adjustCredits).toHaveBeenNthCalledWith(2, 'author-1', 3, 'novel_analysis_refund')
      })

      it('signal 미지정이면 기존 동작 유지 (정상 경로)', async () => {
        mockVectorStore.searchSimilar.mockResolvedValue([
          { chunkText: '청크', episodeId: 'ep-1', chunkIndex: 0, distance: 0.1 },
        ])
        mockCheckConsistency.mockResolvedValue({
          type: 'consistency', score: 90, summary: 'ok', issues: [], suggestions: [],
        })

        const results = await useCase.analyzeNewEpisode(
          'author-1', 'work-1', '새 텍스트', ['consistency'], undefined, undefined,
        )

        expect(results).toHaveLength(1)
        // 환불은 호출되지 않음 (정상 성공)
        expect(mockCreditRepo.adjustCredits).toHaveBeenCalledTimes(1)
        expect(mockCreditRepo.adjustCredits).toHaveBeenCalledWith('author-1', -3, 'novel_analysis')
      })
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
