import { Theme } from './theme'

export interface Author {
  id: string
  slug: string
  name: string
  email: string
  passwordHash?: string
  bio?: string
  role: string
  credits: number
  createdAt: Date
}

/** 외부 노출용 작가 정보 (민감 필드 제거) */
export type SafeAuthor = Omit<Author, 'passwordHash' | 'email' | 'role'>

/** 작가 공개 프로필 — SafeAuthor + 통계 + 작품 목록 */
export interface AuthorPublicProfile {
  author: SafeAuthor
  works: (WorkSummary & { viewCount: number })[]
  subscriberCount: number
  totalLikes: number
}

/** Author → SafeAuthor 변환 (passwordHash, email, role 제거) */
export function toSafeAuthor(author: Author): SafeAuthor {
  const { passwordHash, email, role, ...safe } = author
  return safe
}

/** 작가 공간 데이터 (테마 + 작품 목록 포함) */
export interface AuthorSpace {
  author: SafeAuthor
  theme: Theme | null
  works: WorkSummary[]
}

export interface WorkSummary {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  episodeCount: number
}
