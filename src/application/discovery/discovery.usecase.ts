import { Injectable, Inject } from '@nestjs/common'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { SafeAuthor, toSafeAuthor } from '@domain/model/author'
import { WorkWithMeta } from '@domain/model/work'

@Injectable()
export class DiscoveryUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
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
}
