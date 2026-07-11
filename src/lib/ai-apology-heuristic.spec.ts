import { looksLikeAiApology } from './ai-apology-heuristic'

/**
 * F-5 — AI 챗봇 사과문 관찰 휴리스틱 spec.
 *
 * 보수적 AND 결합(사과 표현 + AI 자기지칭 동시)만 true → 정상 작가 지침 오탐 최소화.
 */
describe('looksLikeAiApology', () => {
  it('빈 입력/누락은 false', () => {
    expect(looksLikeAiApology(null)).toBe(false)
    expect(looksLikeAiApology(undefined)).toBe(false)
    expect(looksLikeAiApology('')).toBe(false)
  })

  it('사과 표현 + AI 자기지칭 동시 → true (2026-05-30 오염 패턴)', () => {
    expect(
      looksLikeAiApology(
        '죄송합니다. 저는 AI 어시스턴트로서 해당 요청을 처리할 수 없습니다.',
      ),
    ).toBe(true)
  })

  it('영문 챗봇 사과문도 검출', () => {
    expect(
      looksLikeAiApology('I am sorry, but as an AI language model I cannot help.'),
    ).toBe(true)
  })

  it('사과 표현만 있고 AI 자기지칭 없으면 false (정상 작가 지침 오탐 방지)', () => {
    expect(
      looksLikeAiApology('주인공이 죄송하다고 사과하는 장면의 톤을 부드럽게 유지할 것'),
    ).toBe(false)
  })

  it('AI 단어만 있고 사과 표현 없으면 false', () => {
    expect(
      looksLikeAiApology('이 작품은 AI 어시스턴트가 등장하는 SF 세계관이다'),
    ).toBe(false)
  })

  it('정상 프로젝트 메모리는 false', () => {
    expect(
      looksLikeAiApology('세계관: 근미래 서울. 주인공 도리안은 냉소적이며 문체는 건조하게.'),
    ).toBe(false)
  })
})
