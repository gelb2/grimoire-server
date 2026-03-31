/**
 * 파싱된 콘텐츠의 최소 단위 — 모든 파서(MD, DOCX, HWPX)의 공통 출력 규격
 *
 * 정본: MD 파서 (md-parser.ts)
 * 규칙: 어떤 포맷에서 파싱하든 동일한 type + 필드 조합을 사용해야 한다.
 *       프론트엔드(ChapterBlock)는 파일 출처를 알 필요 없이 Block.type만으로 렌더링한다.
 *
 * type 목록 (MD 파서 정본 기준):
 *   heading-1  — # 대제목         → title 필드
 *   heading-2  — ## 소제목         → title 필드
 *   chapter    — ### 챕터 제목     → title 필드 + num 필드 (선택)
 *   paragraph  — 일반 문단         → text 필드
 *   separator  — --- 구분선        → 필드 없음
 *   divider    — * * * 장식 구분선 → 필드 없음
 *   italic     — *이탤릭 문단*     → text 필드
 *   bold       — **볼드 문단**     → text 필드
 *   refrain    — > 인용/후렴       → text 필드
 *   epilogue   — ### 에필로그      → 필드 없음
 *   reviews-wrap — 리뷰 컨테이너   → children 필드
 *   review     — 개별 리뷰         → stars + reviewText 필드
 */
export interface Block {
  type: string
  num?: string
  title?: string
  text?: string
  stars?: string
  reviewText?: string
  variant?: string
  children?: Block[]
}
