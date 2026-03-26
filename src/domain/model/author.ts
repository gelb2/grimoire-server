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

/** 작가 공간 데이터 (테마 + 작품 목록 포함) */
export interface AuthorSpace {
  author: Author
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
