import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Get, Post, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { ChatUseCase } from '@application/chat/chat.usecase'

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatUseCase: ChatUseCase) {}

  /** 새 채팅 세션 생성 */
  @Post('sessions')
  async createSession(@Req() req: AuthenticatedRequest, @Body() body: { workId: string; title?: string }) {
    return this.chatUseCase.createSession(req.user.sub, body.workId, body.title)
  }

  /** 세션 목록 조회 */
  @Get('sessions')
  async listSessions(@Req() req: AuthenticatedRequest, @Query('workId') workId: string) {
    return this.chatUseCase.listSessions(req.user.sub, workId)
  }

  /** 메시지 전송 + AI 응답 */
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('sessions/:sessionId/messages')
  async sendMessage(
    @Req() req: AuthenticatedRequest,
    @Param('sessionId') sessionId: string,
    @Body() body: { content: string },
  ) {
    return this.chatUseCase.sendMessage(req.user.sub, sessionId, body.content)
  }

  /** 메시지 히스토리 (커서 기반 페이지네이션) */
  @Get('sessions/:sessionId/messages')
  async getMessages(
    @Req() req: AuthenticatedRequest,
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.chatUseCase.getMessages(req.user.sub, sessionId, parseInt(limit || '30', 10), cursor)
  }

  /** 세션 삭제 */
  @Delete('sessions/:sessionId')
  async deleteSession(@Req() req: AuthenticatedRequest, @Param('sessionId') sessionId: string) {
    await this.chatUseCase.deleteSession(req.user.sub, sessionId)
    return { deleted: true }
  }
}
