/**
 * 파싱된 콘텐츠의 최소 단위 — 모든 파서(MD, DOCX, HWPX)의 공통 출력 규격
 *
 * ※ 이 파일이 BlockType의 단일 진실 공급원(정본)이다.
 * ※ 웹(grimoire-web/src/features/reader/data/index.ts)은 이 목록을 복사해서 사용한다.
 * ※ 새 타입 추가 시: 이 파일 → 웹 동기화 → ChapterBlock case 추가 → PARSER.md 업데이트
 *
 * 파서는 정적(어떤 작가/테마든 동일), 테마는 동적(작가마다 다름).
 * 파서가 이 목록 밖의 type을 만들면 정규화 레이어(block-normalizer.ts)에서 paragraph로 폴백한다.
 */

/** 허용된 블록 타입 목록 (중앙 레지스트리) */
export const BLOCK_TYPES = [
  'heading-1',     // # 대제목         → title 필드
  'heading-2',     // ## 소제목         → title 필드
  'chapter',       // ### 챕터 제목     → title 필드 + num 필드 (선택)
  'paragraph',     // 일반 문단         → text 필드
  'separator',     // --- 구분선        → 필드 없음
  'divider',       // * * * 장식 구분선 → 필드 없음
  'italic',        // *이탤릭 문단*     → text 필드
  'bold',          // **볼드 문단**     → text 필드
  'refrain',       // > 인용/후렴       → text 필드
  'epilogue',      // ### 에필로그      → 필드 없음
  'reviews-wrap',  // 리뷰 컨테이너    → children 필드
  'review',        // 개별 리뷰         → stars + reviewText 필드
] as const

/** 블록 타입 유니온 (컴파일 타임 검증) */
export type BlockType = typeof BLOCK_TYPES[number]

/** 블록 인터페이스 */
export interface Block {
  type: BlockType
  num?: string
  title?: string
  text?: string
  stars?: string
  reviewText?: string
  variant?: string
  children?: Block[]
}
