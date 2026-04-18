import { Controller, Get, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { DiscoveryUseCase } from '@application/discovery/discovery.usecase'

/**
 * Discovery — 공개 인기/최신/검색 엔드포인트.
 * 비인증이고 트래픽이 높으므로 rate limit으로 봇 보호.
 */
@Throttle({ default: { ttl: 60000, limit: 60 } })  // 분당 60회 per IP
@Controller('discover')
export class DiscoveryController {
  constructor(private readonly discoveryUseCase: DiscoveryUseCase) {}

  /** 작가 검색 (이름/슬러그) */
  @Get('authors')
  async searchAuthors(@Query('q') query: string, @Query('limit') limit?: string) {
    return this.discoveryUseCase.searchAuthors(query || '', limit ? parseInt(limit, 10) : 10)
  }

  /** 인기 작품 조회 (페이지네이션 지원) */
  @Get('works/popular')
  async getPopularWorks(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
  ) {
    // 페이지네이션 파라미터가 있으면 페이지네이션 응답
    if (page) {
      return this.discoveryUseCase.getPopularWorksPaginated(
        parseInt(page, 10) || 1,
        parseInt(pageSize || '12', 10),
      )
    }
    // 기존 호환: limit만 전달 시 배열 응답
    return this.discoveryUseCase.getPopularWorks(limit ? parseInt(limit, 10) : 10)
  }

  /** 응원받는 작가 — 크레딧 선물 총액 랭킹 */
  @Get('authors/most-gifted')
  async getMostGiftedAuthors(@Query('limit') limit?: string) {
    return this.discoveryUseCase.getMostGiftedAuthors(limit ? parseInt(limit, 10) : 8)
  }

  /** 최신 작품 조회 (페이지네이션 지원) */
  @Get('works/recent')
  async getRecentWorks(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
  ) {
    // 페이지네이션 파라미터가 있으면 페이지네이션 응답
    if (page) {
      return this.discoveryUseCase.getRecentWorksPaginated(
        parseInt(page, 10) || 1,
        parseInt(pageSize || '12', 10),
      )
    }
    // 기존 호환: limit만 전달 시 배열 응답
    return this.discoveryUseCase.getRecentWorks(limit ? parseInt(limit, 10) : 10)
  }
}
