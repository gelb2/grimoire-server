/**
 * prompt-injection-guard.ts — LLM Prompt Injection 입력 검증 (OWASP LLM Top 10 #1)
 *
 * 책 V1.1 Ch 17 보안 Layer 1 + Constitutional AI 차용.
 * Constitution P17 (Red Team Constitution 16→19 Principles)에 박제.
 *
 * 검증 패턴 (false positive 회피용 — 명령형 + LLM-control 키워드만):
 *   - "ignore previous instructions" (변형 포함)
 *   - "ignore all previous"
 *   - "disregard the above"
 *   - "</prompt>" XML 종료 태그 (system prompt 종료 시도)
 *   - "[SYSTEM]" 또는 "[INST]" 명시적 시스템 마커
 *   - "you are now ..."
 *
 * 작가 소설 본문에 자연스럽게 등장 가능한 단어는 제외:
 *   - "system prompt" 단독 (✗ 패턴 — 소설에 등장 가능)
 *   - "ignore" 단독 (✗)
 *
 * 검출 시 BadRequestException throw + 로그 박제 (sensor가 추적).
 *
 * 신설: 2026-05-03 #10_6 묶음 FF (사용자 명시 P17 진행)
 */

import { BadRequestException, Logger } from '@nestjs/common'

const PROMPT_INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /ignore\s+(?:all\s+)?(?:previous|above)\s+instructions/i,
  /disregard\s+(?:all\s+|the\s+)?(?:previous|above)/i,
  /<\/prompt>|<\/system>|<\/instructions>/i,
  /\[SYSTEM\]|\[INST\]|\[\/INST\]/i,
  /you\s+are\s+now\s+(?:a|an)\s+/i,
  /forget\s+(?:all\s+)?(?:previous|above)\s+(?:instructions|context|rules)/i,
]

const logger = new Logger('PromptInjectionGuard')

/**
 * 사용자 입력에서 prompt injection 의심 패턴 검출.
 * @param input — 검증할 사용자 입력 텍스트
 * @param context — 로그용 컨텍스트 (예: "chat.sendMessage", "analysis.run")
 * @throws BadRequestException — injection 패턴 검출 시
 */
export function guardPromptInjection(input: string, context = 'unknown'): void {
  if (!input || input.length === 0) return

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      // 로그 박제 (sensor 추적 가능)
      logger.warn(
        `Prompt injection 의심 패턴 검출 (${context}): pattern=${pattern.source} | input 앞 50자="${input.slice(0, 50)}..."`,
      )
      throw new BadRequestException({
        message: '입력에 허용되지 않는 패턴이 포함되어 있습니다. 자연스러운 문장으로 다시 작성해주세요.',
        code: 'PROMPT_INJECTION_DETECTED',
        // 패턴 자체는 클라이언트에 노출하지 않음 (회피 학습 방지)
      })
    }
  }
}

/**
 * 검증 패턴 개수 반환 (테스트용)
 */
export function getPromptInjectionPatternCount(): number {
  return PROMPT_INJECTION_PATTERNS.length
}
