import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Get, Patch, Delete, Param, Body, UseGuards, Req, HttpCode } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AuthorUseCase } from '@application/author/author.usecase'
import { UserSoftDeleteUseCase } from '@application/author/user-soft-delete.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('authors')
export class AuthorController {
  constructor(
    private readonly authorUseCase: AuthorUseCase,
    private readonly userSoftDelete: UserSoftDeleteUseCase,
  ) {}

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

  /**
   * USER-SOFT-DELETE sprint (2026-05-15) — 본인 탈퇴 영역 영역 엔드포인트.
   *
   * 흐름:
   * 1. JWT 인증 영역 (JwtAuthGuard 영역)
   * 2. UserSoftDeleteUseCase.execute(authorId, 'self') 영역 호출 영역
   * 3. soft delete + GDPR 익명화 + RefreshToken 즉시 무효 + AdminAuditLog 박제
   *
   * 정본: .claude/state/sprint-user-soft-delete-draft.md §5-4 Hexagonal 흐름 매트릭스
   * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
   */
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async deleteMyAccount(@Req() req: AuthenticatedRequest) {
    await this.userSoftDelete.execute(req.user.sub, 'self')
    return { deleted: true, message: '계정이 탈퇴 처리되었습니다. 30일 후 자동 영구 삭제 영역 정합.' }
  }
}
