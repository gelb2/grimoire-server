import { checkConsistency, checkTone, checkCharacter, AskFn } from './novel-analyzer'

describe('novel-analyzer', () => {
  let mockAsk: jest.MockedFunction<AskFn>

  beforeEach(() => {
    mockAsk = jest.fn()
  })

  it('설정 붕괴를 체크한다', async () => {
    mockAsk.mockResolvedValue(JSON.stringify({
      score: 85,
      summary: '대체로 일관됨',
      issues: ['캐릭터 나이 불일치'],
      suggestions: ['3화에서 나이 설정 확인'],
    }))

    const result = await checkConsistency(mockAsk, '기존 에피소드...', '새 에피소드...')
    expect(result.type).toBe('consistency')
    expect(result.score).toBe(85)
    expect(result.issues).toHaveLength(1)
    expect(mockAsk).toHaveBeenCalledTimes(1)
  })

  it('톤 일관성을 체크한다', async () => {
    mockAsk.mockResolvedValue(JSON.stringify({
      score: 90,
      summary: '톤이 일관됨',
      issues: [],
      suggestions: [],
    }))

    const result = await checkTone(mockAsk, '기존 에피소드...', '새 에피소드...')
    expect(result.type).toBe('tone')
    expect(result.score).toBe(90)
  })

  it('캐릭터 어감을 체크한다', async () => {
    mockAsk.mockResolvedValue(JSON.stringify({
      score: 70,
      summary: '일부 캐릭터 말투 변화',
      issues: ['주인공 말투 변화'],
      suggestions: ['대사 톤 통일'],
    }))

    const result = await checkCharacter(mockAsk, '기존 에피소드...', '새 에피소드...')
    expect(result.type).toBe('character')
    expect(result.score).toBe(70)
    expect(result.issues).toContain('주인공 말투 변화')
  })

  it('JSON 파싱 실패 시 분석 실패 상태를 반환한다 (2회 재시도 후)', async () => {
    mockAsk.mockResolvedValue('이것은 JSON이 아닙니다')

    const result = await checkConsistency(mockAsk, '기존', '새로운')
    // 파싱 2회 시도 후 모두 실패하면 score = -1 (분석 실패 명시)
    expect(result.score).toBe(-1)
    expect(result.summary).toContain('분석 실패')
    expect(mockAsk).toHaveBeenCalledTimes(2)
  })

  it('trailing comma가 있는 JSON도 파싱한다', async () => {
    mockAsk.mockResolvedValue('{"score": 80, "summary": "결과", "issues": ["문제",], "suggestions": [],}')

    const result = await checkConsistency(mockAsk, '기존', '새로운')
    expect(result.score).toBe(80)
  })

  describe('SDK signal 전파 (HARNESS §10 Phase 4)', () => {
    it('checkConsistency: signal 전달 시 ask options.signal로 전파된다', async () => {
      mockAsk.mockResolvedValue(JSON.stringify({ score: 80, summary: 's', issues: [], suggestions: [] }))
      const controller = new AbortController()

      await checkConsistency(mockAsk, '기존', '새로운', undefined, controller.signal)

      expect(mockAsk).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      )
    })

    it('checkTone / checkCharacter도 동일하게 signal 전파', async () => {
      mockAsk.mockResolvedValue(JSON.stringify({ score: 90, summary: 's', issues: [], suggestions: [] }))
      const controller = new AbortController()

      await checkTone(mockAsk, '기존', '새로운', undefined, controller.signal)
      await checkCharacter(mockAsk, '기존', '새로운', undefined, controller.signal)

      expect(mockAsk).toHaveBeenCalledTimes(2)
      expect(mockAsk).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      )
      expect(mockAsk).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      )
    })

    it('signal 미전달 시 기존 동작 유지 (options.signal 없음)', async () => {
      mockAsk.mockResolvedValue(JSON.stringify({ score: 70, summary: 's', issues: [], suggestions: [] }))

      await checkConsistency(mockAsk, '기존', '새로운')

      const callArgs = mockAsk.mock.calls[0][2]
      expect(callArgs?.signal).toBeUndefined()
    })

    it('aborted signal 상태에서 ask가 throw하면 즉시 throw (재시도 swallow 안 함)', async () => {
      const controller = new AbortController()
      controller.abort()
      const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
      mockAsk.mockRejectedValue(abortError)

      await expect(
        checkConsistency(mockAsk, '기존', '새로운', undefined, controller.signal),
      ).rejects.toBe(abortError)

      // signal이 aborted면 첫 시도 throw 즉시 전파 — 재시도 안 함
      expect(mockAsk).toHaveBeenCalledTimes(1)
    })

    it('signal 미아보트 + ask 일반 throw는 1회 재시도 (기존 동작 보존)', async () => {
      mockAsk
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValueOnce(JSON.stringify({ score: 60, summary: 's', issues: [], suggestions: [] }))

      const result = await checkConsistency(mockAsk, '기존', '새로운')
      expect(result.score).toBe(60)
      expect(mockAsk).toHaveBeenCalledTimes(2)
    })
  })
})
