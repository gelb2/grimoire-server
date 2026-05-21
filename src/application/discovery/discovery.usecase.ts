import { Injectable, Inject } from '@nestjs/common'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { SafeAuthor, toSafeAuthor } from '@domain/model/author'
import { WorkWithMeta, PaginatedWorks } from '@domain/model/work'

export interface GiftedAuthor {
  id: string
  slug: string
  name: string
  bio: string | null
  totalGifted: number
}

/**
 * 크레딧 개편 CC-4 Phase 1 (2026-05-21) — 신·구 분열 해소 L2a.
 *
 * 변경: `creditRepo.getGiftRanking` 직접 호출 → `CreditUseCase.getGiftRanking` 위임.
 * CreditUseCase 가 CC-3 (HIGH-3) 에서 ledger 위임/폴백 분기를 박제했으므로 본 위임으로
 * 신 선물(`source='gift'`)이 `/discovery/most-gifted-authors` 에 인식됨.
 */
@Injectable()
export class DiscoveryUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    private readonly creditUseCase: CreditUseCase,
  ) {}

  /** 이름/슬러그로 작가 검색 (민감 필드 제거) */
  async searchAuthors(query: string, limit = 10): Promise<SafeAuthor[]> {
    const authors = await this.authorRepo.search(query, limit)
    return authors.map(toSafeAuthor)
  }

  /** 인기 작품 조회 (viewCount 내림차순) */
  async getPopularWorks(limit = 10): Promise<WorkWithMeta[]> {
    return this.workRepo.findPopular(limit)
  }

  /** 최신 작품 조회 (createdAt 내림차순) */
  async getRecentWorks(limit = 10): Promise<WorkWithMeta[]> {
    return this.workRepo.findRecent(limit)
  }

  /** 인기 작품 페이지네이션 조회 */
  async getPopularWorksPaginated(page = 1, pageSize = 12): Promise<PaginatedWorks> {
    const { works, totalCount } = await this.workRepo.findPopularPaginated(page, pageSize)
    return {
      works,
      totalCount,
      page,
      pageSize,
      hasMore: page * pageSize < totalCount,
    }
  }

  /** 최신 작품 페이지네이션 조회 */
  async getRecentWorksPaginated(page = 1, pageSize = 12): Promise<PaginatedWorks> {
    const { works, totalCount } = await this.workRepo.findRecentPaginated(page, pageSize)
    return {
      works,
      totalCount,
      page,
      pageSize,
      hasMore: page * pageSize < totalCount,
    }
  }

  /** 응원받는 작가 — 크레딧 선물 총액 기준 랭킹 (CC-4 P1 L2a — CreditUseCase 위임) */
  async getMostGiftedAuthors(limit = 8): Promise<GiftedAuthor[]> {
    const ranking = await this.creditUseCase.getGiftRanking(limit)
    if (ranking.length === 0) return []

    // 작가 정보 조회
    const authors = await Promise.all(
      ranking.map(r => this.authorRepo.findById(r.authorId)),
    )

    return ranking
      .map((r, i) => {
        const author = authors[i]
        if (!author) return null
        return {
          id: author.id,
          slug: author.slug,
          name: author.name,
          bio: author.bio ?? null,
          totalGifted: r.totalGifted,
        }
      })
      .filter((a): a is GiftedAuthor => a !== null)
  }
}
