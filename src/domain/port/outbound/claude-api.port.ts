import { AuthorTheme } from '@domain/model/theme'

export interface AskOptions {
  maxTokens?: number
}

export interface ClaudeApiPort {
  /** 테마 생성 (구조화 프롬프트 + JSON 파싱) */
  generateTheme(description: string): Promise<AuthorTheme>

  /** 범용 Claude 호출 — 분석, 요약 등 어디서든 사용 */
  ask(systemPrompt: string, userMessage: string, options?: AskOptions): Promise<string>
}
