import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Get, Patch, Param, Body, UseGuards, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AuthorUseCase } from '@application/author/author.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('authors')
export class AuthorController {
  constructor(private readonly authorUseCase: AuthorUseCase) {}

  @Get(':slug')
  async getAuthorSpace(@Param('slug') slug: string) {
    return this.authorUseCase.getAuthorSpace(slug)
  }

  /** 작가 공개 프로필 조회 — 작품 목록 + 구독자수 + 좋아요수 */
  @Get(':slug/profile')
  async getPublicProfile(@Param('slug') slug: string) {
    return this.authorUseCase.getPublicProfile(slug)
  }

  /** 작가 프로필(name, bio) 수정 — 인증 필요, 본인만 가능 */
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Patch(':slug/profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: { name?: string; bio?: string }) {
    return this.authorUseCase.updateProfile(slug, req.user.sub, body)
  }
}
