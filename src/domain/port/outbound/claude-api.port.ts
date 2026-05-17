import { AuthorTheme } from '@domain/model/theme'

export interface AskOptions {
  maxTokens?: number
  /**
   * 클라이언트 disconnect / 서버 abort 발생 시 Anthropic API 호출 자체를 cancel하기 위한 signal.
   * 미전달 시 기존 동작 유지 (호출 cancel 안 됨). HARNESS §10 Phase 4 — SDK signal 전파.
   */
  signal?: AbortSignal
}

/**
 * Claude 응답 + 토큰 usage.
 * 크레딧 개편 I Phase (2026-05-17) — 채팅 4구간 차감은 input 토큰 실측이 선행 필수
 * (§8-8 CRITICAL #3).
 */
export interface ClaudeAskResult {
  text: string
  inputTokens: number
  outputTokens: number
  model: string
}

export interface ClaudeApiPort {
  /** 테마 생성 (구조화 프롬프트 + JSON 파싱) */
  generateTheme(description: string): Promise<AuthorTheme>

  /** 범용 Claude 호출 — 분석, 요약 등 어디서든 사용 */
  ask(systemPrompt: string, userMessage: string, options?: AskOptions): Promise<string>

  /**
   * 범용 Claude 호출 + 토큰 usage 반환.
   * 크레딧 개편 I Phase — 채팅 사후 차감(4구간)이 input_tokens 로 구간 판정.
   */
  askWithUsage(
    systemPrompt: string,
    userMessage: string,
    options?: AskOptions,
  ): Promise<ClaudeAskResult>
}
