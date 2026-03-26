import { checkConsistency, checkTone, checkCharacter } from './novel-analyzer'
import * as claude from '@lib/claude'

jest.mock('@lib/claude')
const mockAskClaude = claude.askClaude as jest.MockedFunction<typeof claude.askClaude>

describe('novel-analyzer', () => {
  beforeEach(() => {
    mockAskClaude.mockReset()
  })

  it('설정 붕괴를 체크한다', async () => {
    mockAskClaude.mockResolvedValue(JSON.stringify({
      score: 85,
      summary: '대체로 일관됨',
      issues: ['캐릭터 나이 불일치'],
      suggestions: ['3화에서 나이 설정 확인'],
    }))

    const result = await checkConsistency('기존 에피소드...', '새 에피소드...')
    expect(result.type).toBe('consistency')
    expect(result.score).toBe(85)
    expect(result.issues).toHaveLength(1)
  })

  it('톤 일관성을 체크한다', async () => {
    mockAskClaude.mockResolvedValue(JSON.stringify({
      score: 90,
      summary: '톤이 일관됨',
      issues: [],
      suggestions: [],
    }))

    const result = await checkTone('기존 에피소드...', '새 에피소드...')
    expect(result.type).toBe('tone')
    expect(result.score).toBe(90)
  })

  it('캐릭터 어감을 체크한다', async () => {
    mockAskClaude.mockResolvedValue(JSON.stringify({
      score: 70,
      summary: '일부 캐릭터 말투 변화',
      issues: ['주인공 말투 변화'],
      suggestions: ['대사 톤 통일'],
    }))

    const result = await checkCharacter('기존 에피소드...', '새 에피소드...')
    expect(result.type).toBe('character')
    expect(result.score).toBe(70)
    expect(result.issues).toContain('주인공 말투 변화')
  })

  it('JSON 파싱 실패 시 기본값을 반환한다', async () => {
    mockAskClaude.mockResolvedValue('이것은 JSON이 아닙니다')

    const result = await checkConsistency('기존', '새로운')
    expect(result.score).toBe(50)
    expect(result.summary).toContain('JSON 파싱 실패')
  })

  it('trailing comma가 있는 JSON도 파싱한다', async () => {
    mockAskClaude.mockResolvedValue('{"score": 80, "summary": "결과", "issues": ["문제",], "suggestions": [],}')

    const result = await checkConsistency('기존', '새로운')
    expect(result.score).toBe(80)
  })
})
