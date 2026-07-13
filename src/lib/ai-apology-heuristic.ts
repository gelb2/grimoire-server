/**
 * F-5 (2026-07-11) — Work.context / instructions 저장 시 "명백한 AI 챗봇 사과문" 관찰용 휴리스틱.
 *
 * 배경: 2026-05-30 prod `works.context` 오염 사건 (채팅 AI 사과문 481자가 주입됨).
 *       context/instructions 는 AI 채팅 시스템 프롬프트 주입원 → 오염 시 후속 세션 전체가 왜곡된다.
 *
 * 방침 (과차단 방지 — 관찰 우선):
 *   - **차단하지 않는다.** 저장은 허용하되, 명백한 패턴이면 호출자가 warn 로그 + AuditLog 로
 *     관찰만 한다 (운영자 사후 판단 영역). 정상 작가 지침에도 "죄송"/"AI" 단어가 개별 등장할 수
 *     있으므로, 오탐을 줄이기 위해 **사과 표현 + AI 자기지칭이 동시** 존재할 때만 true (보수적 AND).
 *
 * 작가 콘텐츠 보호: 본 함수는 boolean 판정만 반환한다. 입력 원문은 반환·로깅하지 않는다.
 */

/** 사과 표현 — 챗봇 상투구 */
const APOLOGY_PATTERN =
  /(죄송합니다|죄송해요|죄송하지만|사과\s*(?:를\s*)?드립니다|사과드려요|sorry|apologi[sz]e)/i

/** AI 자기지칭 — "저는 AI …" 류 */
const AI_SELF_REFERENCE_PATTERN =
  /(AI\s*어시스턴트|인공지능\s*어시스턴트|AI\s*(?:언어\s*)?모델|언어\s*모델|저는\s*(?:하나의\s*)?(?:AI|인공지능)|as\s+an\s+ai|i\s+am\s+an\s+ai|ai\s+assistant|language\s+model)/i

/**
 * 명백한 AI 챗봇 사과문 패턴 여부 (보수적 — 사과 표현 AND AI 자기지칭 동시 존재).
 *
 * @param text 검사 대상 (Work.context / instructions). null/빈 문자열은 false.
 * @returns 두 패턴이 모두 검출되면 true (차단이 아니라 관찰 트리거)
 */
export function looksLikeAiApology(text: string | null | undefined): boolean {
  if (!text) return false
  return APOLOGY_PATTERN.test(text) && AI_SELF_REFERENCE_PATTERN.test(text)
}
