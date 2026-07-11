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

/** 기본 Episode/Work 모킹 헬퍼 — 소유권 검증 통과 + 충분한 본문 길이 */
const makeEpisode = (overrides: Partial<{ id: string; workId: string; rawMd: string }> = {}) => ({
  id: 'ep-1',
  workId: 'work-1',
  slug: 'ep-1',
  title: '테스트 에피소드',
  subtitle: null,
  description: null,
  type: 'episode',
  orderNum: 1,
  blocks: [],
  rawMd: '에피소드 본문 텍스트입니다. 충분히 길게 작성합니다.',
  viewCount: 0,
  sourceFormat: 'markdown',
  isIndexed: true,
  status: 'public',
  sharedToken: null,
  sharedExpireAt: null,
  createdAt: new Date(),
  ...overrides,
})

const makeWork = (overrides: Partial<{ id: string; authorId: string; title: string; context: string | null; instructions: string | null }> = {}) => ({
  id: 'work-1',
  authorId: 'author-1',
  slug: 'work-1',
  title: '테스트 작품',
  subtitle: null,
  description: null,
  coverImage: null,
  context: null,
  instructions: null,
  themeId: null,
  viewCount: 0,
  createdAt: new Date(),
  ...overrides,
})

/**
 * 크레딧 개편 CC-4 Phase 1 (2026-05-21) — novel-analysis spec 정리.
 *
 * 변경 사항:
 *   - 생성자 시그니처 변경 — `creditRepo` 인자 제거(CC-4 P1h). chargePoints 가 production
 *     단위로 항상 주입되어 구 폴백 경로 제거.
 *   - 구 mockCreditRepo / mockCreditRepo.adjustCredits 검증 제거 (구 경로 자체 폐기).
 *   - 모든 it 블록을 chargePoints(디노미 차감) 경로 단일화 — 신 경로 회귀 안전망.
 */
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
  let mockWorkRepo: {
    findById: jest.Mock
    findEpisodes: jest.Mock
    findEpisodeById: jest.Mock
  }
  let mockReportRepo: { create: jest.Mock; findByAuthor: jest.Mock; findById: jest.Mock }
  let mockChargePoints: {
    chargeAnalysis: jest.Mock
    refundAnalysis: jest.Mock
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
      findById: jest.fn().mockResolvedValue(makeWork()),
      findEpisodes: jest.fn().mockResolvedValue([]),
      findEpisodeById: jest.fn().mockResolvedValue(makeEpisode()),
    }
    mockReportRepo = {
      create: jest.fn().mockResolvedValue({}),
      findByAuthor: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
    }
    // CC-1 §5-D — chargeAnalysis 는 SpendResult 를 반환 (출처별 환불 복원 입력)
    mockChargePoints = {
      chargeAnalysis: jest.fn().mockResolvedValue({
        spentBySource: { free: 2440, subscription: 0, gift: 0, charged: 0 },
        deficitIncurred: 0,
        balanceAfter: 0,
      }),
      refundAnalysis: jest.fn().mockResolvedValue(undefined),
    }

    // 5번째 인자 = reportRepo, 6번째 인자 = chargePoints (CC-4 Phase 1 시그니처)
    useCase = new NovelAnalysisUseCase(
      mockVectorStore as any,
      mockEmbedding as any,
      mockClaude as any,
      mockWorkRepo as any,
      mockReportRepo as any,
      mockChargePoints as any,
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

  describe('analyzeEpisode (Q1=(a) 에피소드 ID 모드)', () => {
    it('episodeId로 DB의 rawMd를 로드해 분석을 수행한다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(
        makeEpisode({ id: 'ep-1', workId: 'work-1', rawMd: 'DB에서 로드된 본문 내용입니다.' }),
      )
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: 'ep-2_0', workId: 'work-1', episodeId: 'ep-2', chunkIndex: 0, chunkText: '다른 회차 청크', distance: 0.2 },
      ] as any)
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: 90, summary: 'ok', issues: [], suggestions: [],
      })

      await useCase.analyzeEpisode('author-1', 'ep-1', ['consistency'])

      // DB rawMd로 임베딩 호출 확인
      expect(mockEmbedding.getEmbedding).toHaveBeenCalledWith('DB에서 로드된 본문 내용입니다.')
      // workId는 Episode 실제 workId 사용 (body 신뢰 X)
      expect(mockVectorStore.searchSimilar).toHaveBeenCalledWith([0.1, 0.2, 0.3], 30, 'work-1')
    })

    it('자기 자신 청크는 RAG 컨텍스트에서 자동 제외된다 (self-reference 환각 방지)', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(
        makeEpisode({ id: 'ep-9', workId: 'work-1', rawMd: '9화 본문 텍스트입니다 충분히 길게 작성합니다' }),
      )
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: 'ep-9_0', workId: 'work-1', episodeId: 'ep-9', chunkIndex: 0, chunkText: '자기 자신 청크', distance: 0.1 },
        { id: 'ep-5_2', workId: 'work-1', episodeId: 'ep-5', chunkIndex: 2, chunkText: '다른 에피소드 청크', distance: 0.3 },
      ] as any)
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: 90, summary: 'ok', issues: [], suggestions: [],
      })

      await useCase.analyzeEpisode('author-1', 'ep-9', ['consistency'])

      const context = mockCheckConsistency.mock.calls[0][1] as string
      expect(context).toContain('ep-5')
      expect(context).not.toContain('자기 자신 청크')
      expect(context).toContain('다른 에피소드 청크')
    })

    it('비교할 다른 회차가 없으면 score=100 placeholder를 반환한다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(
        makeEpisode({ id: 'ep-1', workId: 'work-1' }),
      )
      // 자기 자신 청크만 검색됨 → 필터 후 0개
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: 'ep-1_0', workId: 'work-1', episodeId: 'ep-1', chunkIndex: 0, chunkText: '자기', distance: 0.0 },
      ] as any)

      const results = await useCase.analyzeEpisode('author-1', 'ep-1')

      expect(results).toHaveLength(3)
      results.forEach((r) => {
        expect(r.score).toBe(100)
        expect(r.summary).toContain('비교할 다른 에피소드가 없')
      })
    })

    it('특정 분석 타입만 요청할 수 있다', async () => {
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: 'ep-2_0', workId: 'work-1', episodeId: 'ep-2', chunkIndex: 0, chunkText: '청크', distance: 0.2 },
      ] as any)
      mockCheckTone.mockResolvedValue({
        type: 'tone' as const, score: 90, summary: '톤 분석', issues: [], suggestions: [],
      })

      const results = await useCase.analyzeEpisode('author-1', 'ep-1', ['tone'])

      expect(mockCheckTone).toHaveBeenCalled()
      expect(mockCheckConsistency).not.toHaveBeenCalled()
      expect(mockCheckCharacter).not.toHaveBeenCalled()
      expect(results).toHaveLength(1)
      expect(results[0].type).toBe('tone')
    })

    it('Work 메타(context/instructions)가 분석 함수에 전달된다', async () => {
      mockWorkRepo.findById.mockResolvedValue(
        makeWork({ context: '현대 판타지', instructions: '느와르 톤' }),
      )
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: 'ep-2_0', workId: 'work-1', episodeId: 'ep-2', chunkIndex: 0, chunkText: '청크', distance: 0.1 },
      ] as any)
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: 90, summary: 'ok', issues: [], suggestions: [],
      })

      await useCase.analyzeEpisode('author-1', 'ep-1', ['consistency'])

      const workMetaArg = mockCheckConsistency.mock.calls[0][3]
      expect(workMetaArg).toEqual({
        title: '테스트 작품', context: '현대 판타지', instructions: '느와르 톤',
      })
    })

    it('에피소드 제목을 컨텍스트 라벨에 포함한다', async () => {
      mockWorkRepo.findEpisodes.mockResolvedValue([
        { id: 'ep-9', title: '도리안그레이의 초상', orderNum: 9, type: 'episode' },
      ])
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: 'ep-9_2', workId: 'work-1', episodeId: 'ep-9', chunkIndex: 2, chunkText: '청크내용', distance: 0.1 },
      ] as any)
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: 90, summary: 'ok', issues: [], suggestions: [],
      })

      // 분석 대상은 ep-1, RAG에서 ep-9가 검색됨
      await useCase.analyzeEpisode('author-1', 'ep-1', ['consistency'])

      const context = mockCheckConsistency.mock.calls[0][1] as string
      expect(context).toContain('제9화 "도리안그레이의 초상"')
      expect(context).toContain('청크 2')
    })

    it('환각 검증 — 원문에 없는 인용은 issues에서 제거된다', async () => {
      const newText = '에피소드 텍스트입니다. 원문에 있는 구절 이 여기 들어있어요.'
      mockWorkRepo.findEpisodeById.mockResolvedValue(
        makeEpisode({ id: 'ep-1', workId: 'work-1', rawMd: newText }),
      )
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: 'ep-2_0', workId: 'work-1', episodeId: 'ep-2', chunkIndex: 0, chunkText: '청크', distance: 0.1 },
      ] as any)
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: 80, summary: '이슈 있음',
        issues: [
          '설정 충돌 — "원문에 있는 구절"',  // 통과
          '허위 인용 — "존재하지 않는 내용"',  // 제외
          '인용 누락 issue',                 // 제외 (따옴표 없음)
        ],
        suggestions: [],
      })

      const results = await useCase.analyzeEpisode('author-1', 'ep-1', ['consistency'])

      expect(results[0].issues).toHaveLength(1)
      expect(results[0].issues[0]).toContain('원문에 있는 구절')
    })

    it('분석 실패(score=-1) 결과는 환각 검증에서 손대지 않는다', async () => {
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: 'ep-2_0', workId: 'work-1', episodeId: 'ep-2', chunkIndex: 0, chunkText: '청크', distance: 0.1 },
      ] as any)
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: -1, summary: '분석 실패 (AI 호출 오류)',
        issues: [], suggestions: [],
      })

      const results = await useCase.analyzeEpisode('author-1', 'ep-1', ['consistency'])

      expect(results[0].score).toBe(-1)
      expect(results[0].summary).toContain('분석 실패')
    })

    // 보안 — IDOR 방지 (CLAUDE.md §0 정책 강제)
    describe('소유권 검증 (IDOR 방지)', () => {
      it('Episode가 없으면 BadRequest', async () => {
        mockWorkRepo.findEpisodeById.mockResolvedValue(null)

        await expect(useCase.analyzeEpisode('author-1', 'no-such-ep')).rejects.toThrow('에피소드를 찾을 수 없습니다')
        expect(mockChargePoints.chargeAnalysis).not.toHaveBeenCalled()
      })

      it('Work가 없으면 BadRequest', async () => {
        mockWorkRepo.findEpisodeById.mockResolvedValue(makeEpisode())
        mockWorkRepo.findById.mockResolvedValue(null)

        await expect(useCase.analyzeEpisode('author-1', 'ep-1')).rejects.toThrow('작품을 찾을 수 없습니다')
        expect(mockChargePoints.chargeAnalysis).not.toHaveBeenCalled()
      })

      it('타인 작품 에피소드는 분석 거부 (크레딧 차감 전)', async () => {
        mockWorkRepo.findEpisodeById.mockResolvedValue(makeEpisode({ workId: 'work-1' }))
        mockWorkRepo.findById.mockResolvedValue(makeWork({ authorId: 'OTHER_AUTHOR' }))

        await expect(useCase.analyzeEpisode('author-1', 'ep-1')).rejects.toThrow('본인 작품의 에피소드만')
        expect(mockChargePoints.chargeAnalysis).not.toHaveBeenCalled()
      })

      it('rawMd가 너무 짧으면 BadRequest (크레딧 차감 전)', async () => {
        mockWorkRepo.findEpisodeById.mockResolvedValue(makeEpisode({ rawMd: '짧음' }))

        await expect(useCase.analyzeEpisode('author-1', 'ep-1')).rejects.toThrow('너무 짧')
        expect(mockChargePoints.chargeAnalysis).not.toHaveBeenCalled()
      })
    })

    // 크레딧 개편 CC-4 Phase 1 — chargePoints 디노미 차감 단일화 (구 정수 차감 제거)
    describe('크레딧 차감 (CC-4 Phase 1 — 디노미 단일 경로)', () => {
      it('소유권 검증 통과 후 chargeAnalysis(디노미 차감) 1회 호출', async () => {
        mockVectorStore.searchSimilar.mockResolvedValue([])
        await useCase.analyzeEpisode('author-1', 'ep-1')

        expect(mockChargePoints.chargeAnalysis).toHaveBeenCalledWith('author-1')
      })

      it('chargeAnalysis 가 잔액 부족으로 throw 하면 분석을 진행하지 않는다', async () => {
        mockChargePoints.chargeAnalysis.mockRejectedValueOnce(new Error('포인트가 부족합니다'))

        await expect(useCase.analyzeEpisode('author-1', 'ep-1')).rejects.toThrow('부족')
        expect(mockVectorStore.searchSimilar).not.toHaveBeenCalled()
        expect(mockCheckConsistency).not.toHaveBeenCalled()
      })

      it('분석 중 예외가 나면 refundAnalysis 호출 (출처별 복원 + deficit 역전)', async () => {
        mockVectorStore.searchSimilar.mockRejectedValue(new Error('벡터 DB 장애'))

        await expect(useCase.analyzeEpisode('author-1', 'ep-1')).rejects.toThrow('벡터 DB 장애')

        expect(mockChargePoints.chargeAnalysis).toHaveBeenCalledWith('author-1')
        // F-10 — spentBySource + deficitIncurred(0) 를 함께 전달
        expect(mockChargePoints.refundAnalysis).toHaveBeenCalledWith(
          'author-1',
          undefined,
          { free: 2440, subscription: 0, gift: 0, charged: 0 },
          0,
        )
      })

      // F-10 — 동시성 race 로 deficit 발생 시, 실패 환불에 deficitIncurred 를 전달해 외상 역전
      it('chargeAnalysis 가 deficit 을 동반하면 refundAnalysis 에 deficitIncurred 를 전달한다', async () => {
        mockChargePoints.chargeAnalysis.mockResolvedValueOnce({
          spentBySource: { free: 0, subscription: 0, gift: 0, charged: 1940 },
          deficitIncurred: 500,
          balanceAfter: 0,
        })
        mockVectorStore.searchSimilar.mockRejectedValue(new Error('벡터 DB 장애'))

        await expect(useCase.analyzeEpisode('author-1', 'ep-1')).rejects.toThrow('벡터 DB 장애')

        expect(mockChargePoints.refundAnalysis).toHaveBeenCalledWith(
          'author-1',
          undefined,
          { free: 0, subscription: 0, gift: 0, charged: 1940 },
          500,
        )
      })

      it('chargePoints 미주입 시 BadRequest (production DI 누락 안전 fail)', async () => {
        const ucNoCharge = new NovelAnalysisUseCase(
          mockVectorStore as any,
          mockEmbedding as any,
          mockClaude as any,
          mockWorkRepo as any,
          mockReportRepo as any,
        )
        await expect(ucNoCharge.analyzeEpisode('author-1', 'ep-1')).rejects.toThrow(
          'chargePoints 미주입',
        )
      })
    })

    // 2026-04-19 P0: 클라이언트 HTTP disconnect 대응 — AbortSignal 기반 중단 + 환불 보장
    describe('AbortSignal 기반 클라이언트 disconnect 대응', () => {
      it('이미 aborted된 signal이 오면 즉시 AbortedError로 중단하고 환불한다', async () => {
        const controller = new AbortController()
        controller.abort()

        await expect(
          useCase.analyzeEpisode('author-1', 'ep-1', undefined, controller.signal),
        ).rejects.toThrow(/중단/)

        expect(mockChargePoints.chargeAnalysis).toHaveBeenCalledWith('author-1')
        expect(mockChargePoints.refundAnalysis).toHaveBeenCalled()
        expect(mockVectorStore.searchSimilar).not.toHaveBeenCalled()
        expect(mockCheckConsistency).not.toHaveBeenCalled()
      })

      it('첫 workRepo 조회 진행 중 abort되면 AbortedError + 환불', async () => {
        // findEpisodeById/findById는 즉시 반환 (소유권 통과). 이후 runAnalysis 안의 findById/findEpisodes에서 무한 대기.
        const realFindById = mockWorkRepo.findById.getMockImplementation()
        let callCount = 0
        mockWorkRepo.findById.mockImplementation(async (id: string) => {
          callCount += 1
          if (callCount === 1) return realFindById ? realFindById(id) : makeWork()
          return new Promise(() => {})  // runAnalysis 안의 두 번째 호출은 무한 대기
        })
        mockWorkRepo.findEpisodes.mockImplementation(() => new Promise(() => {}))

        const controller = new AbortController()
        const promise = useCase.analyzeEpisode('author-1', 'ep-1', undefined, controller.signal)
        await new Promise((r) => setImmediate(r))
        controller.abort()

        await expect(promise).rejects.toThrow(/중단/)

        expect(mockChargePoints.chargeAnalysis).toHaveBeenCalledWith('author-1')
        expect(mockChargePoints.refundAnalysis).toHaveBeenCalled()
      })

      it('signal 미지정이면 기존 동작 유지 (정상 경로)', async () => {
        mockVectorStore.searchSimilar.mockResolvedValue([
          { id: 'ep-2_0', workId: 'work-1', episodeId: 'ep-2', chunkIndex: 0, chunkText: '청크', distance: 0.1 },
        ] as any)
        mockCheckConsistency.mockResolvedValue({
          type: 'consistency', score: 90, summary: 'ok', issues: [], suggestions: [],
        })

        const results = await useCase.analyzeEpisode('author-1', 'ep-1', ['consistency'], undefined)

        expect(results).toHaveLength(1)
        expect(mockChargePoints.chargeAnalysis).toHaveBeenCalledTimes(1)
        expect(mockChargePoints.refundAnalysis).not.toHaveBeenCalled()
      })
    })
  })

  describe('리포트 영구 저장 (성공 시)', () => {
    it('분석 성공 시 reportRepo.create로 저장한다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue(
        makeEpisode({ id: 'ep-1', workId: 'work-1', rawMd: '본문 텍스트입니다 충분히 길게' }),
      )
      mockWorkRepo.findById.mockResolvedValue(makeWork({ id: 'work-1', authorId: 'author-1', title: '사슴악마' }))
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: 'ep-2_0', workId: 'work-1', episodeId: 'ep-2', chunkIndex: 0, chunkText: '청크', distance: 0.1 },
      ] as any)
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: 90, summary: 'ok', issues: [], suggestions: [],
      })

      await useCase.analyzeEpisode('author-1', 'ep-1', ['consistency'])

      expect(mockReportRepo.create).toHaveBeenCalledTimes(1)
      const arg = mockReportRepo.create.mock.calls[0][0]
      expect(arg).toMatchObject({
        authorId: 'author-1',
        workId: 'work-1',
        episodeId: 'ep-1',
        workTitle: '사슴악마',
        types: ['consistency'],
        // CC-4 Phase 1: chargePoints 항상 주입 → ANALYSIS_POINT_COST(2,440 pt) 저장
        creditsCharged: 2440,
      })
      expect(arg.results).toHaveLength(1)
      expect(arg.results[0].score).toBe(90)
    })

    it('리포트 저장 실패 시에도 분석 결과는 반환한다 (catch 보호)', async () => {
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: 'ep-2_0', workId: 'work-1', episodeId: 'ep-2', chunkIndex: 0, chunkText: '청크', distance: 0.1 },
      ] as any)
      mockCheckConsistency.mockResolvedValue({
        type: 'consistency', score: 90, summary: 'ok', issues: [], suggestions: [],
      })
      mockReportRepo.create.mockRejectedValueOnce(new Error('DB 장애'))

      const results = await useCase.analyzeEpisode('author-1', 'ep-1', ['consistency'])

      expect(results).toHaveLength(1)
      expect(results[0].score).toBe(90)
    })

    it('분석 실패 시에는 리포트를 저장하지 않는다 (환불만)', async () => {
      mockVectorStore.searchSimilar.mockRejectedValue(new Error('벡터 DB 장애'))

      await expect(useCase.analyzeEpisode('author-1', 'ep-1')).rejects.toThrow('벡터 DB 장애')
      expect(mockReportRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('listReports / getReport', () => {
    it('listReports — repo의 findByAuthor를 50건으로 호출', async () => {
      mockReportRepo.findByAuthor.mockResolvedValue([{ id: 'r-1' }])

      const list = await useCase.listReports('author-1')

      expect(mockReportRepo.findByAuthor).toHaveBeenCalledWith('author-1', 50)
      expect(list).toEqual([{ id: 'r-1' }])
    })

    it('getReport — 존재하지 않으면 NotFoundException', async () => {
      mockReportRepo.findById.mockResolvedValue(null)

      await expect(useCase.getReport('author-1', 'r-x')).rejects.toThrow('찾을 수 없습니다')
    })

    it('getReport — 타인 리포트는 ForbiddenException', async () => {
      mockReportRepo.findById.mockResolvedValue({ id: 'r-1', authorId: 'OTHER' })

      await expect(useCase.getReport('author-1', 'r-1')).rejects.toThrow('본인의 분석 리포트')
    })

    it('getReport — 본인 리포트는 그대로 반환', async () => {
      const report = { id: 'r-1', authorId: 'author-1', results: [] }
      mockReportRepo.findById.mockResolvedValue(report)

      const got = await useCase.getReport('author-1', 'r-1')

      expect(got).toBe(report)
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
