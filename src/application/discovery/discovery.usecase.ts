import { Injectable, Inject } from '@nestjs/common'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { Author } from '@domain/model/author'
import { Work } from '@domain/model/work'

@Injectable()
export class DiscoveryUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
  ) {}

  /** 이름/슬러그로 작가 검색 */
  async searchAuthors(query: string, limit = 10): Promise<Author[]> {
    return this.authorRepo.search(query, limit)
  }

  /** 인기 작품 조회 (viewCount 내림차순) */
  async getPopularWorks(limit = 10): Promise<Work[]> {
    return this.workRepo.findPopular(limit)
  }

  /** 최신 작품 조회 (createdAt 내림차순) */
  async getRecentWorks(limit = 10): Promise<Work[]> {
    return this.workRepo.findRecent(limit)
  }
}
