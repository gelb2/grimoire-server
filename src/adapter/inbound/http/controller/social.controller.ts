import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Post, Get, Delete, Body, Param, UseGuards, Req, Res } from '@nestjs/common'
import { Response } from 'express'
import { Throttle } from '@nestjs/throttler'
import { v4 as uuidv4 } from 'uuid'
import { SocialUseCase } from '@application/social/social.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { OptionalAuthGuard } from '@adapter/inbound/http/guard/optional-auth.guard'
import { extractClientIp } from '@adapter/inbound/http/util/ip-extractor'
import { isRemoteEnv } from '@infrastructure/config/app-env'

@Controller('social')
export class SocialController {
  constructor(private readonly socialUseCase: SocialUseCase) {}

  // ── 좋아요 ──

  /** 좋아요 토글/생성 — 로그인: 토글, 비로그인: 생성(취소 불가) */
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Post('likes/:episodeId')
  @UseGuards(OptionalAuthGuard)
  async toggleLike(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('episodeId') episodeId: string,
  ) {
    if (req.user) {
      return this.socialUseCase.toggleLike(req.user.sub, episodeId)
    }

    // 익명 좋아요
    const ipAddress = extractClientIp(req)
    let cookieId = req.cookies?.grimoire_anon
    if (!cookieId) {
      cookieId = uuidv4()
      res.cookie('grimoire_anon', cookieId, {
        httpOnly: true,
        maxAge: 365 * 24 * 60 * 60 * 1000, // 1년
        sameSite: 'lax',
        secure: isRemoteEnv(),
      })
    }

    const result = await this.socialUseCase.anonymousLike(episodeId, ipAddress, cookieId)
    return result
  }

  /** 좋아요 상태 + 수 조회 (로그인/비로그인 모두) */
  @Get('likes/:episodeId/status')
  @UseGuards(OptionalAuthGuard)
  async getLikeStatus(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string) {
    const authorId = req.user?.sub
    const ipAddress = !authorId ? extractClientIp(req) : undefined
    const cookieId = !authorId ? req.cookies?.grimoire_anon : undefined
    return this.socialUseCase.getLikeStatus(episodeId, authorId, ipAddress, cookieId)
  }

  /** 에피소드 좋아요 수 조회 (공개) */
  @Get('likes/:episodeId/count')
  async getLikeCount(@Param('episodeId') episodeId: string) {
    const count = await this.socialUseCase.getLikeCount(episodeId)
    return { count }
  }

  // ── 구독 ──

  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Post('subscriptions/:authorId')
  @UseGuards(JwtAuthGuard)
  async toggleSubscription(@Req() req: AuthenticatedRequest, @Param('authorId') authorId: string) {
    return this.socialUseCase.toggleSubscription(req.user.sub, authorId)
  }

  @Get('subscriptions')
  @UseGuards(JwtAuthGuard)
  async getSubscriptions(@Req() req: AuthenticatedRequest) {
    return this.socialUseCase.getSubscriptions(req.user.sub)
  }

  @Get('subscriptions/:authorId/count')
  async getSubscriberCount(@Param('authorId') authorId: string) {
    const count = await this.socialUseCase.getSubscriberCount(authorId)
    return { count }
  }

  // ── 댓글 ──

  /** 댓글 작성 — 로그인: authorId 기반, 비로그인: 닉네임+비밀번호 */
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('comments/:episodeId')
  @UseGuards(OptionalAuthGuard)
  async createComment(
    @Req() req: AuthenticatedRequest,
    @Param('episodeId') episodeId: string,
    @Body() body: { content: string; parentId?: string; nickname?: string; password?: string; website?: string },
  ) {
    // honeypot — 봇은 숨겨진 website 필드를 채움, 사람은 비워둠
    if (body.website) {
      // 봇으로 판단 — 성공한 것처럼 빈 응답 반환 (봇에게 실패를 알리지 않음)
      return { id: 'blocked', episodeId, content: body.content, createdAt: new Date() }
    }

    if (req.user) {
      return this.socialUseCase.createComment(req.user.sub, episodeId, body.content, body.parentId)
    }

    // 익명 댓글
    const ipAddress = extractClientIp(req)
    return this.socialUseCase.createAnonymousComment({
      episodeId,
      content: body.content,
      nickname: body.nickname || '',
      password: body.password || '',
      ipAddress,
      parentId: body.parentId,
    })
  }

  /** 에피소드 댓글 목록 조회 (공개) */
  @Get('comments/:episodeId')
  async getComments(@Param('episodeId') episodeId: string) {
    return this.socialUseCase.getComments(episodeId)
  }

  /** 댓글 삭제 — 로그인: authorId 확인, 비로그인: 비밀번호 확인 */
  @Delete('comments/:commentId')
  @UseGuards(OptionalAuthGuard)
  async deleteComment(
    @Req() req: AuthenticatedRequest,
    @Param('commentId') commentId: string,
    @Body() body: { password?: string },
  ) {
    if (req.user) {
      await this.socialUseCase.deleteComment(commentId, req.user.sub)
    } else {
      await this.socialUseCase.deleteAnonymousComment(commentId, body.password || '')
    }
    return { deleted: true }
  }

  // ── 크레딧 선물 ──

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('gift/:authorSlug')
  @UseGuards(JwtAuthGuard)
  async giftCredits(@Req() req: AuthenticatedRequest, @Param('authorSlug') authorSlug: string, @Body() body: { amount: number }) {
    return this.socialUseCase.giftCredits(req.user.sub, authorSlug, body.amount)
  }
}
