/**
 * 파싱된 콘텐츠의 최소 단위
 * DeerDevil Block 시스템에서 이관
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
