/**
 * 소설 분석 모듈 — RAG 기반
 * 설정 붕괴, 톤 일관성, 캐릭터 어감 체크
 */

import { askClaude } from '@lib/claude'

export interface AnalysisResult {
  type: 'consistency' | 'tone' | 'character'
  score: number       // 0~100
  summary: string
  issues: string[]
  suggestions: string[]
}

const CONSISTENCY_PROMPT = `당신은 소설 편집자입니다. 아래에 기존 소설의 일부(컨텍스트)와 새 에피소드가 주어집니다.

다음 관점에서 분석하세요:

1. **설정 붕괴**: 기존 에피소드에서 확립된 세계관, 규칙, 캐릭터 설정이 새 에피소드에서 모순되는 부분이 있는지
2. **해결된 갈등 재등장**: 이미 해결된 갈등이 재등장하거나, 있었던 사건이 없었던 것처럼 다뤄지는지

반드시 아래 JSON 형식으로만 응답하세요:
{
  "score": 0~100 (100이 완벽한 일관성),
  "summary": "한 줄 요약",
  "issues": ["발견된 문제 1", "발견된 문제 2"],
  "suggestions": ["개선 제안 1", "개선 제안 2"]
}`

const TONE_PROMPT = `당신은 소설 편집자입니다. 아래에 기존 소설의 일부(컨텍스트)와 새 에피소드가 주어집니다.

작품 전체의 톤(문체, 분위기, 서술 시점, 묘사 밀도)이 일관되게 유지되는지 분석하세요.

- 갑자기 문체가 바뀌거나, 서술 시점이 흔들리거나, 분위기가 급변하는 부분
- 이전 에피소드 대비 묘사의 밀도나 속도감이 크게 달라지는 부분

반드시 아래 JSON 형식으로만 응답하세요:
{
  "score": 0~100 (100이 완벽한 톤 일관성),
  "summary": "한 줄 요약",
  "issues": ["발견된 문제 1"],
  "suggestions": ["개선 제안 1"]
}`

const CHARACTER_PROMPT = `당신은 소설 편집자입니다. 아래에 기존 소설의 일부(컨텍스트)와 새 에피소드가 주어집니다.

등장인물의 대사 패턴, 어감, 성격이 일관되게 유지되는지 분석하세요.

- 이전에 반말을 쓰던 캐릭터가 갑자기 존댓말을 쓰거나
- 내성적이던 캐릭터가 갑자기 외향적으로 행동하거나
- 캐릭터 고유의 말투, 입버릇이 사라지거나 달라지는 부분

반드시 아래 JSON 형식으로만 응답하세요:
{
  "score": 0~100 (100이 완벽한 캐릭터 일관성),
  "summary": "한 줄 요약",
  "issues": ["발견된 문제 1"],
  "suggestions": ["개선 제안 1"]
}`

/** 설정 붕괴 체크 */
export async function checkConsistency(context: string, newEpisode: string): Promise<AnalysisResult> {
  const userMessage = `[기존 에피소드 컨텍스트]\n${context}\n\n[새 에피소드]\n${newEpisode}`
  const raw = await askClaude(CONSISTENCY_PROMPT, userMessage, { maxTokens: 2048 })
  return { type: 'consistency', ...parseAnalysisJSON(raw) }
}

/** 톤 일관성 체크 */
export async function checkTone(context: string, newEpisode: string): Promise<AnalysisResult> {
  const userMessage = `[기존 에피소드 컨텍스트]\n${context}\n\n[새 에피소드]\n${newEpisode}`
  const raw = await askClaude(TONE_PROMPT, userMessage, { maxTokens: 2048 })
  return { type: 'tone', ...parseAnalysisJSON(raw) }
}

/** 캐릭터 어감 체크 */
export async function checkCharacter(context: string, newEpisode: string): Promise<AnalysisResult> {
  const userMessage = `[기존 에피소드 컨텍스트]\n${context}\n\n[새 에피소드]\n${newEpisode}`
  const raw = await askClaude(CHARACTER_PROMPT, userMessage, { maxTokens: 2048 })
  return { type: 'character', ...parseAnalysisJSON(raw) }
}

/** Claude 응답 JSON 파싱 (에러 복구 포함) */
function parseAnalysisJSON(raw: string): { score: number; summary: string; issues: string[]; suggestions: string[] } {
  try {
    // JSON 블록 추출
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        score: parsed.score ?? 50,
        summary: parsed.summary ?? '분석 완료',
        issues: parsed.issues ?? [],
        suggestions: parsed.suggestions ?? [],
      }
    }
  } catch {
    // trailing comma 제거 후 재시도
    try {
      const cleaned = raw.replace(/,\s*([\]}])/g, '$1')
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          score: parsed.score ?? 50,
          summary: parsed.summary ?? '분석 완료',
          issues: parsed.issues ?? [],
          suggestions: parsed.suggestions ?? [],
        }
      }
    } catch { /* fall through */ }
  }

  return { score: 50, summary: 'JSON 파싱 실패 — 원본: ' + raw.slice(0, 200), issues: [], suggestions: [] }
}
