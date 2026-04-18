/**
 * 소설 분석 모듈 — 순수 함수
 * AI 호출 함수를 외부에서 주입받아 테스트 가능하게 유지
 *
 * Claude Projects 스타일 참고 사항:
 * - 시스템 프롬프트에 작품 맥락/지침 동적 주입 (WorkMeta)
 * - 역할 명시 (참고 컨텍스트 vs 검토 대상)
 * - 응답에 "새 에피소드 내 인용" 강제 → usecase에서 환각 검증
 * - 파싱 실패 시 1회 재시도 + 실패 상태 구분
 */

/** AI 호출 함수 시그니처 — ClaudeApiPort.ask 또는 mock 주입 */
export type AskFn = (systemPrompt: string, userMessage: string, options?: { maxTokens?: number }) => Promise<string>

export interface AnalysisResult {
  type: 'consistency' | 'tone' | 'character'
  score: number       // 0~100 (-1 = 분석 실패)
  summary: string
  issues: string[]
  suggestions: string[]
}

/** 프롬프트에 주입할 작품 메타 (Claude Projects의 "프로젝트 지침" 역할) */
export interface WorkMeta {
  title?: string | null
  context?: string | null      // 세계관/캐릭터/배경
  instructions?: string | null // 문체/톤 지침
}

// 역할 분리·환각 방지 공통 규칙 — 각 프롬프트 최상단에 주입
const CONTEXT_ROLE_DISCLAIMER = `**중요 규칙 (반드시 준수)**:
- [기존 에피소드 컨텍스트]는 **참고용** 입니다. 과거 에피소드의 설정·톤·캐릭터를 이해하는 데만 씁니다.
- [새 에피소드]는 **검토 대상** 입니다. 문제 보고는 오직 [새 에피소드] 본문에 **실제로 존재하는 내용**에 대해서만 하십시오.
- [기존 에피소드 컨텍스트]에만 있고 [새 에피소드]에는 없는 요소를 "새 에피소드의 문제"로 보고하지 마십시오.
- issues 각 항목에는 반드시 [새 에피소드]에서 해당 문제가 나타난 구절 8~20자를 큰따옴표로 인용하십시오. 인용 불가능하면 그 항목은 issues에 포함하지 마십시오.`

/** 작품 맥락·지침 블록 (있을 때만 삽입) */
function buildWorkBlock(work?: WorkMeta): string {
  if (!work) return ''
  const parts: string[] = []
  if (work.context) parts.push(`[작품 맥락]\n${work.context}`)
  if (work.instructions) parts.push(`[작품 지침]\n${work.instructions}`)
  if (parts.length === 0) return ''
  return parts.join('\n\n') + '\n\n'
}

/** 동적 시스템 프롬프트 빌더 */
function buildSystemPrompt(
  role: string,
  analysisInstruction: string,
  scoreLabel: string,
  work?: WorkMeta,
): string {
  const who = work?.title ? `"${work.title}"의 전담 편집자` : '소설 편집자'
  return `당신은 ${who}입니다. 아래에 기존 소설의 일부(컨텍스트)와 새 에피소드가 주어집니다.

${buildWorkBlock(work)}${CONTEXT_ROLE_DISCLAIMER}

${role}
${analysisInstruction}

반드시 아래 JSON 형식으로만 응답하세요 (issues 각 항목은 "문제 설명 — \\"새 에피소드 인용 8~20자\\"" 포맷):
{
  "score": 0~100 (100이 ${scoreLabel}),
  "summary": "한 줄 요약",
  "issues": ["발견된 문제 1 — \\"새 에피소드 인용\\""],
  "suggestions": ["개선 제안 1"]
}`
}

const CONSISTENCY_INSTRUCTION = `다음 관점에서 분석하세요:

1. **설정 붕괴**: 기존 에피소드에서 확립된 세계관, 규칙, 캐릭터 설정이 **새 에피소드 내**에서 모순되는 부분
2. **해결된 갈등 재등장**: **새 에피소드**가 이미 해결된 갈등을 재등장시키거나, 있었던 사건이 없었던 것처럼 다루는지`

const TONE_INSTRUCTION = `작품 전체의 톤(문체, 분위기, 서술 시점, 묘사 밀도)이 **새 에피소드**에서 일관되게 유지되는지 분석하세요.

- **새 에피소드 내에서** 갑자기 문체가 바뀌거나, 서술 시점이 흔들리거나, 분위기가 급변하는 부분
- 이전 에피소드 대비 묘사의 밀도나 속도감이 크게 달라지는 부분`

const CHARACTER_INSTRUCTION = `등장인물의 대사 패턴, 어감, 성격이 **새 에피소드**에서도 일관되게 유지되는지 분석하세요.

- **새 에피소드에서** 이전에 반말을 쓰던 캐릭터가 갑자기 존댓말을 쓰거나
- **새 에피소드에서** 내성적이던 캐릭터가 갑자기 외향적으로 행동하거나
- **새 에피소드에서** 캐릭터 고유의 말투, 입버릇이 사라지거나 달라지는 부분`

/** 분석 실패 결과 — score=-1 로 명시 */
function makeFailure(type: AnalysisResult['type'], reason: string): AnalysisResult {
  return { type, score: -1, summary: `분석 실패 (${reason})`, issues: [], suggestions: [] }
}

/** 단일 분석 실행 — JSON 파싱 실패 시 1회 재시도 */
async function runAnalysis(
  type: AnalysisResult['type'],
  systemPrompt: string,
  userMessage: string,
  ask: AskFn,
): Promise<AnalysisResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await ask(systemPrompt, userMessage, { maxTokens: 2048 })
      const parsed = tryParseAnalysisJSON(raw)
      if (parsed) return { type, ...parsed }
      // 파싱 실패 → 다음 시도
    } catch (err) {
      // Claude API 오류 → 재시도 (1회만)
      if (attempt === 1) {
        const msg = err instanceof Error ? err.message : String(err)
        return makeFailure(type, `AI 호출 오류: ${msg.slice(0, 80)}`)
      }
    }
  }
  return makeFailure(type, 'JSON 파싱 불가 (2회 시도)')
}

/** 설정 붕괴 체크 */
export async function checkConsistency(ask: AskFn, context: string, newEpisode: string, work?: WorkMeta): Promise<AnalysisResult> {
  const systemPrompt = buildSystemPrompt('', CONSISTENCY_INSTRUCTION, '완벽한 일관성', work)
  const userMessage = `[기존 에피소드 컨텍스트]\n${context}\n\n[새 에피소드]\n${newEpisode}`
  return runAnalysis('consistency', systemPrompt, userMessage, ask)
}

/** 톤 일관성 체크 */
export async function checkTone(ask: AskFn, context: string, newEpisode: string, work?: WorkMeta): Promise<AnalysisResult> {
  const systemPrompt = buildSystemPrompt('', TONE_INSTRUCTION, '완벽한 톤 일관성', work)
  const userMessage = `[기존 에피소드 컨텍스트]\n${context}\n\n[새 에피소드]\n${newEpisode}`
  return runAnalysis('tone', systemPrompt, userMessage, ask)
}

/** 캐릭터 어감 체크 */
export async function checkCharacter(ask: AskFn, context: string, newEpisode: string, work?: WorkMeta): Promise<AnalysisResult> {
  const systemPrompt = buildSystemPrompt('', CHARACTER_INSTRUCTION, '완벽한 캐릭터 일관성', work)
  const userMessage = `[기존 에피소드 컨텍스트]\n${context}\n\n[새 에피소드]\n${newEpisode}`
  return runAnalysis('character', systemPrompt, userMessage, ask)
}

/**
 * Claude 응답 JSON 파싱 (에러 복구 포함)
 * 실패 시 null 반환 (makeFailure는 runAnalysis가 재시도 후 호출).
 */
function tryParseAnalysisJSON(raw: string): { score: number; summary: string; issues: string[]; suggestions: string[] } | null {
  const attempts: string[] = [raw, raw.replace(/,\s*([\]}])/g, '$1')]
  for (const candidate of attempts) {
    try {
      const jsonMatch = candidate.match(/\{[\s\S]*\}/)
      if (!jsonMatch) continue
      const parsed = JSON.parse(jsonMatch[0])
      return {
        score: typeof parsed.score === 'number' ? parsed.score : 50,
        summary: typeof parsed.summary === 'string' ? parsed.summary : '분석 완료',
        issues: Array.isArray(parsed.issues) ? parsed.issues.filter((s: unknown): s is string => typeof s === 'string') : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s: unknown): s is string => typeof s === 'string') : [],
      }
    } catch {
      // 다음 candidate 시도
    }
  }
  return null
}
