/**
 * 블록 정규화 레이어 — 모든 파서 출력이 DB 저장 전에 이 함수를 거친다.
 *
 * 역할:
 * 1. 미지원 블록 타입 → paragraph로 폴백 (텍스트 보존, 조용히 사라지지 않음)
 * 2. heading 블록에 title 없으면 → text를 title로 이동
 * 3. 빈 블록 (내용 없음) 필터링
 * 4. children 블록도 재귀 정규화
 */
import { Block, BLOCK_TYPES, BlockType } from '@domain/model/block'

const VALID_TYPES = new Set<string>(BLOCK_TYPES)

/** heading 계열 타입 (title 필드 사용) */
const HEADING_TYPES = new Set<BlockType>(['heading-1', 'heading-2', 'chapter'])

/** 콘텐츠가 있는지 확인 */
function hasContent(block: Block): boolean {
  if (block.title || block.text) return true
  if (block.type === 'separator' || block.type === 'divider' || block.type === 'epilogue') return true
  if (block.type === 'reviews-wrap' && block.children?.length) return true
  if (block.type === 'review' && (block.stars || block.reviewText)) return true
  return false
}

/** 단일 블록 정규화 */
function normalizeBlock(block: Block): Block | null {
  // 타입 유효성 검사 — 미지원 타입은 paragraph로 폴백
  let type = block.type
  if (!VALID_TYPES.has(type)) {
    type = 'paragraph' as BlockType
  }

  // heading 계열에 title 없으면 text → title 이동
  if (HEADING_TYPES.has(type as BlockType) && !block.title && block.text) {
    return { ...block, type: type as BlockType, title: block.text, text: undefined }
  }

  // children 재귀 정규화
  if (block.children?.length) {
    const normalizedChildren = block.children
      .map(normalizeBlock)
      .filter((b): b is Block => b !== null)
    return { ...block, type: type as BlockType, children: normalizedChildren }
  }

  const normalized = { ...block, type: type as BlockType }

  // 빈 블록 제거
  if (!hasContent(normalized)) return null

  return normalized
}

/** Block[] 정규화 — 파서 출력 → DB 저장 전에 호출 */
export function normalizeBlocks(blocks: Block[]): Block[] {
  return blocks
    .map(normalizeBlock)
    .filter((b): b is Block => b !== null)
}
