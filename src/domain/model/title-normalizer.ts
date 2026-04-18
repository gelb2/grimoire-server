/**
 * 에피소드/작품 제목 정규화.
 *
 * 배경: Safari faux italic 합성 + Noto Serif KR(italic face 부재) 조합에서
 * 한글+Latin+숫자+언더스코어가 밀착된 문자열이 들어오면 Hangul 음절이 자모
 * 단위로 분해돼 렌더된다. 파일명을 그대로 제목으로 쓰면 이 조건에 걸린다.
 *
 * 원칙:
 * - 단일 진실 공급원(domain layer)에서 raw 입력을 safe 형태로 변환.
 * - 보존되어야 하는 기존 타이포그래피(en/em dash, 콜론, 따옴표, 숫자, 영문 등)는
 *   건드리지 않는다. 오직 문제 트리거인 언더스코어만 공백으로 치환하고 공백 정리.
 * - idempotent: normalizeTitle(normalizeTitle(x)) === normalizeTitle(x)
 */
export function normalizeTitle(raw: string): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/_+/g, ' ') // 언더스코어 → 공백 (Safari Hangul shaping 버그 회피)
    .replace(/\s+/g, ' ') // 연속 공백 → 단일 공백
    .trim()
}
