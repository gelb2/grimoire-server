import { AuthorTheme } from '@domain/model/theme'

export interface AskOptions {
  maxTokens?: number
  /**
   * 클라이언트 disconnect / 서버 abort 발생 시 Anthropic API 호출 자체를 cancel하기 위한 signal.
   * 미전달 시 기존 동작 유지 (호출 cancel 안 됨). HARNESS §10 Phase 4 — SDK signal 전파.
   */
  signal?: AbortSignal
}

export interface ClaudeApiPort {
  /** 테마 생성 (구조화 프롬프트 + JSON 파싱) */
  generateTheme(description: string): Promise<AuthorTheme>

  /** 범용 Claude 호출 — 분석, 요약 등 어디서든 사용 */
  ask(systemPrompt: string, userMessage: string, options?: AskOptions): Promise<string>
}
