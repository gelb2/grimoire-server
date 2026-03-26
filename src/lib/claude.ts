/**
 * Claude API 래퍼 — YECHANGPE 패턴
 *
 * 중앙화된 호출 함수로 모든 AI 통신을 관리한다.
 */
import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

export async function askClaude(
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number },
): Promise<string> {
  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: options?.maxTokens ?? 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })
  const block = response.content[0]
  return block.type === 'text' ? block.text : ''
}
