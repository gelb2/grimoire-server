import { Theme } from './theme'

export interface Author {
  id: string
  slug: string
  name: string
  email: string
  passwordHash?: string
  credits: number
  createdAt: Date
}

/** 외부 노출용 작가 정보 (민감 필드 제거) */
export type SafeAuthor = Omit<Author, 'passwordHash' | 'email'>

/** Author → SafeAuthor 변환 (passwordHash, email 제거) */
export function toSafeAuthor(author: Author): SafeAuthor {
  const { passwordHash, email, ...safe } = author
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
