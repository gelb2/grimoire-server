import { Theme } from './theme'

export interface Author {
  id: string
  slug: string
  name: string
  email: string
  passwordHash?: string
  bio?: string
  role: string
  /**
   * CC-4 Phase 3 (2026-05-21) — 구 `credits Int` 컬럼 DROP. 신 4 출처 캐시(`points*`)로 완전 이행.
   * `Author.credits` 필드는 도메인 model + DB 컬럼 양측 제거 (案 P3-Y 옵션 A — 응답 키 `credits`는 controller 측에서 ledger 잔액으로 매핑 보존).
   */
  plan: string
  planExpireAt: Date | null
  defaultThemeId?: string | null
  createdAt: Date
  /**
   * 크레딧 개편 I Phase (2026-05-17) — 포인트 출처 4종 잔액 캐시 (shared-contracts §30).
   * `CreditLedger` 원장이 audit 정본 — 본 4 필드는 빠른 조회용 캐시.
   * schema.prisma `@default(0)` — 항상 존재 (마이그레이션 `credit_overhaul_i_phase`).
   */
  pointsFree: number
  pointsSubscription: number
  pointsGift: number
  pointsCharged: number
  /** 채팅 사후 차감 외상 (deficit) — 충전 시 우선 상계 (§8-4). schema `@default(0)`. */
  deficitPoints: number
  /**
   * USER-SOFT-DELETE sprint (2026-05-15) — Author soft delete 표식.
   * NULL = 활성 / NOT NULL = soft deleted (deletedAt 시점 박제).
   * 30일 후 cron hard delete 정합 (회계 8건 Restrict 영역 PG 자동 차단 시 보류).
   */
  deletedAt: Date | null
}

/** 외부 노출용 작가 정보 (민감 필드 제거) */
export type SafeAuthor = Omit<Author, 'passwordHash' | 'email' | 'role' | 'planExpireAt' | 'deletedAt'>

/** 작가 공개 프로필 — SafeAuthor + 통계 + 작품 목록 */
export interface AuthorPublicProfile {
  author: SafeAuthor
  works: (WorkSummary & { viewCount: number })[]
  subscriberCount: number
  totalLikes: number
}

/** Author → SafeAuthor 변환 (passwordHash, email, role, deletedAt 제거) */
export function toSafeAuthor(author: Author): SafeAuthor {
  const { passwordHash, email, role, planExpireAt, deletedAt, ...safe } = author
  return safe
}

/** USER-SOFT-DELETE: Author soft delete 영역 상태 검증 (deletedAt 영역) */
export function isAuthorDeleted(author: Author): boolean {
  return author.deletedAt !== null
}

/** 작가 공간 데이터 (테마 + 작품 목록 포함) */
export interface AuthorSpace {
  author: SafeAuthor
  theme: Theme | null
  works: WorkSummary[]
}

export interface EpisodeMeta {
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  type: string
  orderNum: number | null
}

export interface WorkSummary {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  episodeCount: number
  episodes: EpisodeMeta[]
}
