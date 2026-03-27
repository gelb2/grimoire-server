import { Controller, Post, Get, Delete, Body, Param, UseGuards, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { SocialUseCase } from '@application/social/social.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('social')
export class SocialController {
  constructor(private readonly socialUseCase: SocialUseCase) {}

  // ── 좋아요 ──

  /** 좋아요 토글 (인증 필요) */
  @Throttle({ default: { ttl: 60000, limit: 30 } })  // 분당 30회
  @Post('likes/:episodeId')
  @UseGuards(JwtAuthGuard)
  async toggleLike(@Req() req: any, @Param('episodeId') episodeId: string) {
    return this.socialUseCase.toggleLike(req.user.sub, episodeId)
  }

  /** 에피소드 좋아요 수 조회 (공개) */
  @Get('likes/:episodeId/count')
  async getLikeCount(@Param('episodeId') episodeId: string) {
    const count = await this.socialUseCase.getLikeCount(episodeId)
    return { count }
  }

  // ── 구독 ──

  /** 구독 토글 (인증 필요) */
  @Throttle({ default: { ttl: 60000, limit: 30 } })  // 분당 30회
  @Post('subscriptions/:authorId')
  @UseGuards(JwtAuthGuard)
  async toggleSubscription(@Req() req: any, @Param('authorId') authorId: string) {
    return this.socialUseCase.toggleSubscription(req.user.sub, authorId)
  }

  /** 내 구독 목록 조회 (인증 필요) */
  @Get('subscriptions')
  @UseGuards(JwtAuthGuard)
  async getSubscriptions(@Req() req: any) {
    return this.socialUseCase.getSubscriptions(req.user.sub)
  }

  /** 작가의 구독자 수 조회 (공개) */
  @Get('subscriptions/:authorId/count')
  async getSubscriberCount(@Param('authorId') authorId: string) {
    const count = await this.socialUseCase.getSubscriberCount(authorId)
    return { count }
  }

  // ── 댓글 ──

  /** 댓글 작성 (인증 필요, parentId로 대댓글 지원) */
  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Post('comments/:episodeId')
  @UseGuards(JwtAuthGuard)
  async createComment(@Req() req: any, @Param('episodeId') episodeId: string, @Body() body: { content: string; parentId?: string }) {
    return this.socialUseCase.createComment(req.user.sub, episodeId, body.content, body.parentId)
  }

  /** 에피소드 댓글 목록 조회 (공개) */
  @Get('comments/:episodeId')
  async getComments(@Param('episodeId') episodeId: string) {
    return this.socialUseCase.getComments(episodeId)
  }

  /** 댓글 삭제 (인증 필요, 본인만 가능) */
  @Delete('comments/:commentId')
  @UseGuards(JwtAuthGuard)
  async deleteComment(@Req() req: any, @Param('commentId') commentId: string) {
    await this.socialUseCase.deleteComment(commentId, req.user.sub)
    return { deleted: true }
  }
}
