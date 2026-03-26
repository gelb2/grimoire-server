/**
 * JSON 파싱 에러 복구 — YECHANGPE 패턴
 *
 * Claude API 응답에서 JSON을 안전하게 추출한다.
 * 3단계 복구: 직접 파싱 → trailing comma 제거 → 마지막 유효 } 까지 잘라내기
 */

/** Claude 응답에서 JSON 객체를 추출 */
export function extractJSON(raw: string): string {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('응답에서 JSON을 찾을 수 없습니다')
  }
  return match[0]
}

/** 3단계 에러 복구 JSON 파싱 */
export function tryParseJSON<T = unknown>(raw: string): T {
  // 1단계: 직접 파싱
  try {
    return JSON.parse(raw) as T
  } catch {
    // 계속
  }

  // 2단계: trailing comma 제거
  const cleaned = raw.replace(/,\s*([\]}])/g, '$1')
  try {
    return JSON.parse(cleaned) as T
  } catch {
    // 계속
  }

  // 3단계: 마지막 유효한 }까지 잘라내기
  for (let i = cleaned.length - 1; i > 0; i--) {
    if (cleaned[i] === '}') {
      try {
        return JSON.parse(cleaned.slice(0, i + 1)) as T
      } catch {
        continue
      }
    }
  }

  throw new Error('JSON 파싱 실패')
}

/** Claude 응답 → JSON 추출 + 파싱 (통합) */
export function parseClaudeJSON<T = unknown>(response: string): T {
  const jsonStr = extractJSON(response)
  return tryParseJSON<T>(jsonStr)
}
