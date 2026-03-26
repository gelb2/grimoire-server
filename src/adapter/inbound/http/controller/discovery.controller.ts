import { Controller, Get, Query } from '@nestjs/common'
import { DiscoveryUseCase } from '@application/discovery/discovery.usecase'

@Controller('discover')
export class DiscoveryController {
  constructor(private readonly discoveryUseCase: DiscoveryUseCase) {}

  /** 작가 검색 (이름/슬러그) */
  @Get('authors')
  async searchAuthors(@Query('q') query: string, @Query('limit') limit?: string) {
    return this.discoveryUseCase.searchAuthors(query || '', limit ? parseInt(limit, 10) : 10)
  }

  /** 인기 작품 조회 */
  @Get('works/popular')
  async getPopularWorks(@Query('limit') limit?: string) {
    return this.discoveryUseCase.getPopularWorks(limit ? parseInt(limit, 10) : 10)
  }

  /** 최신 작품 조회 */
  @Get('works/recent')
  async getRecentWorks(@Query('limit') limit?: string) {
    return this.discoveryUseCase.getRecentWorks(limit ? parseInt(limit, 10) : 10)
  }
}
