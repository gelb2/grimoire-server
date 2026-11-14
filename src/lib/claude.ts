/**
 * Claude API 래퍼 — YECHANGPE 패턴
 *
 * 중앙화된 호출 함수로 모든 AI 통신을 관리한다.
 */
import Anthropic from '@anthropic-ai/sdk'
import { ServiceUnavailableException } from '@nestjs/common'

let client: Anthropic | null = null
let clientApiKey: string | undefined

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new ServiceUnavailableException('AI 기능이 설정되지 않았습니다')
  if (!client || clientApiKey !== apiKey) {
    client = new Anthropic({ apiKey })
    clientApiKey = apiKey
  }
  return client
}

/** Claude API 호출 모델 식별자 (단일 — 크레딧 개편 §8-4 Sonnet 단일) */
export const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

/**
 * Claude 응답 + 토큰 usage.
 * 크레딧 개편 I Phase (2026-05-17) — 채팅 4구간 차감은 input 토큰 실측이 선행 필수
 * (§8-8 CRITICAL #3). usage 없이 차감 = 추측.
 */
export interface ClaudeResponse {
  text: string
  inputTokens: number
  outputTokens: number
  model: string
}

export async function askClaude(
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; signal?: AbortSignal },
): Promise<string> {
  const response = await askClaudeWithUsage(systemPrompt, userMessage, options)
  return response.text
}

/**
 * Claude 호출 + 토큰 usage 반환.
 *
 * 크레딧 개편 I Phase — 채팅 사후 차감(4구간)이 input_tokens 로 구간 판정하므로
 * usage 를 버리지 않고 노출한다. 기존 askClaude 는 본 함수의 text 만 추출하는 래퍼.
 */
export async function askClaudeWithUsage(
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; signal?: AbortSignal },
): Promise<ClaudeResponse> {
  // SDK 두 번째 인자 RequestOptions에 signal 전달 → fetch abort 시 Anthropic API 호출도 즉시 cancel.
  // 서버 abort(클라이언트 disconnect) 시 백그라운드 토큰 낭비 0건화 (HARNESS §10 Phase 4 SDK signal 전파).
  const response = await getClient().messages.create(
    {
      model: CLAUDE_MODEL,
      max_tokens: options?.maxTokens ?? 1024,
      // 프롬프트 캐싱 활성화 — 동일 system prompt가 5분 내 재호출되면 토큰 비용 90%↓.
      // 분석 3종(consistency/tone/character) 병렬 호출 시 system prompt 공유 효과가 큼.
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    },
    options?.signal ? { signal: options.signal } : undefined,
  )
  const block = response.content[0]
  return {
    text: block.type === 'text' ? block.text : '',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: response.model,
  }
}
