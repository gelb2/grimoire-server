import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common'
import { NovelAnalysisUseCase } from '@application/analysis/novel-analysis.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysisUseCase: NovelAnalysisUseCase) {}

  /** 에피소드 인덱싱 (벡터화) */
  @UseGuards(JwtAuthGuard)
  @Post('index')
  async indexEpisode(@Body() body: { episodeId: string; workId: string; rawText: string }) {
    return this.analysisUseCase.indexEpisode(body.episodeId, body.workId, body.rawText)
  }

  /** 새 에피소드 일관성 분석 */
  @UseGuards(JwtAuthGuard)
  @Post('check')
  async analyzeEpisode(
    @Body() body: { workId: string; newEpisodeText: string; types?: ('consistency' | 'tone' | 'character')[] },
  ) {
    return this.analysisUseCase.analyzeNewEpisode(body.workId, body.newEpisodeText, body.types)
  }

  /** 작품 인덱싱 상태 조회 */
  @UseGuards(JwtAuthGuard)
  @Get('status/:workId')
  async getStatus(@Param('workId') workId: string) {
    return this.analysisUseCase.getIndexStatus(workId)
  }
}
