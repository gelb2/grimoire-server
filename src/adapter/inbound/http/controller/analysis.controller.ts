import { Controller, Post, Get, Body, Param, UseGuards, BadRequestException } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { NovelAnalysisUseCase } from '@application/analysis/novel-analysis.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

const RAW_TEXT_MIN_LENGTH = 10
const RAW_TEXT_MAX_LENGTH = 50000

@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysisUseCase: NovelAnalysisUseCase) {}

  /** 에피소드 인덱싱 (벡터화) */
  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @UseGuards(JwtAuthGuard)
  @Post('index')
  async indexEpisode(@Body() body: { episodeId: string; workId: string; rawText: string }) {
    this.validateRawText(body.rawText)
    return this.analysisUseCase.indexEpisode(body.episodeId, body.workId, body.rawText)
  }

  /**
   * 새 에피소드 일관성 분석
   *
   * body.episodeId — 선택. **이미 인덱싱된 에피소드의 재분석** 시 전달하면
   * 해당 episodeId의 청크가 RAG 검색에서 제외된다. 자기 자신 청크가 컨텍스트로
   * 섞여 Claude가 기존 내용을 새 에피소드의 문제로 오보고하는 사태를 방지.
   */
  @Throttle({ default: { ttl: 60000, limit: 3 } })  // AI API 호출 — 분당 3회
  @UseGuards(JwtAuthGuard)
  @Post('check')
  async analyzeEpisode(
    @Body() body: {
      workId: string
      newEpisodeText: string
      types?: ('consistency' | 'tone' | 'character')[]
      episodeId?: string
    },
  ) {
    this.validateRawText(body.newEpisodeText)
    return this.analysisUseCase.analyzeNewEpisode(
      body.workId,
      body.newEpisodeText,
      body.types,
      body.episodeId,
    )
  }

  /** 작품 인덱싱 상태 조회 */
  @UseGuards(JwtAuthGuard)
  @Get('status/:workId')
  async getStatus(@Param('workId') workId: string) {
    return this.analysisUseCase.getIndexStatus(workId)
  }

  /** rawText 입력 검증 (10~50000자) */
  private validateRawText(text: string | undefined): void {
    if (!text || typeof text !== 'string') {
      throw new BadRequestException('텍스트가 필요합니다')
    }
    if (text.length < RAW_TEXT_MIN_LENGTH) {
      throw new BadRequestException(`텍스트는 최소 ${RAW_TEXT_MIN_LENGTH}자 이상이어야 합니다`)
    }
    if (text.length > RAW_TEXT_MAX_LENGTH) {
      throw new BadRequestException(`텍스트는 최대 ${RAW_TEXT_MAX_LENGTH}자까지 허용됩니다`)
    }
  }
}
