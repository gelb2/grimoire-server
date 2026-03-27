import { Controller, Post, Get, Body, Param, UseGuards, Req } from '@nestjs/common'
import { ReaderUseCase } from '@application/reader/reader.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('reader')
@UseGuards(JwtAuthGuard)
export class ReaderController {
  constructor(private readonly readerUseCase: ReaderUseCase) {}

  /** 서재 조회 — 북마크 작품 + 구독 작품 */
  @Get('library')
  async getLibrary(@Req() req: any) {
    return this.readerUseCase.getLibrary(req.user.sub)
  }

  /** 북마크 토글 (추가/제거) */
  @Post('bookmarks/:episodeId')
  async toggleBookmark(@Req() req: any, @Param('episodeId') episodeId: string) {
    return this.readerUseCase.toggleBookmark(req.user.sub, episodeId)
  }

  /** 북마크 목록 조회 */
  @Get('bookmarks')
  async getBookmarks(@Req() req: any) {
    return this.readerUseCase.getBookmarks(req.user.sub)
  }

  /** 읽기 진행도 저장 */
  @Post('progress')
  async saveProgress(@Req() req: any, @Body() body: { episodeId: string; blockIndex: number }) {
    return this.readerUseCase.saveProgress(req.user.sub, body.episodeId, body.blockIndex)
  }

  /** 읽기 진행도 조회 */
  @Get('progress/:episodeId')
  async getProgress(@Req() req: any, @Param('episodeId') episodeId: string) {
    return this.readerUseCase.getProgress(req.user.sub, episodeId)
  }
}
