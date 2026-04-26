import { Controller, Post, Get, Body, Param, Req, UseGuards, BadRequestException } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { NovelAnalysisUseCase } from '@application/analysis/novel-analysis.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'

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
   * 이미 업로드된 에피소드의 일관성 분석 (Q1=(a) 모드, 2026-04-24)
   *
   * Claude Projects 벤치마크 (`docs/ai-analysis-spec.md §6-1`) 정합:
   * - 작가는 회차를 업로드하면 끝 — 분석 화면에서 본문 재입력 강제 금지
   * - body.episodeId만 받아서 서버가 DB의 Episode.rawMd로 분석
   * - 자기 자신 청크는 RAG 검색에서 자동 제외 (usecase 내부)
   *
   * 보안: 소유권 검증은 usecase 진입부에서 수행 (Episode.workId → Work.authorId === JWT sub)
   */
  @Throttle({ default: { ttl: 60000, limit: 3 } })  // AI API 호출 — 분당 3회
  @UseGuards(JwtAuthGuard)
  @Post('check')
  async analyzeEpisode(
    @Req() req: AuthenticatedRequest,
    @Body() body: {
      episodeId: string
      types?: ('consistency' | 'tone' | 'character')[]
    },
  ) {
    if (!body.episodeId || typeof body.episodeId !== 'string' || body.episodeId.trim().length === 0) {
      throw new BadRequestException('episodeId가 필요합니다')
    }
    if (body.types && (!Array.isArray(body.types) || body.types.length === 0)) {
      throw new BadRequestException('types가 비어 있을 수 없습니다')
    }
    // 클라이언트 HTTP abort(프론트 타임아웃, 네트워크 끊김, 사용자 페이지 이탈 등)를
    // AbortSignal로 변환해 usecase에 전달. usecase는 각 단계에서 abortableRace/throwIfAborted로
    // 체크 → AbortedError throw → catch 블록에서 크레딧 환불이 확정된다.
    const abortController = new AbortController()
    const abort = () => abortController.abort()
    req.on('close', abort)
    req.on('aborted', abort)
    try {
      // F2 (2026-04-19 → 2026-04-27 4 크레딧 인상): 분석 호출 시 ANALYSIS_CREDIT_COST 크레딧 차감. IDOR 방지용으로 body 대신 JWT sub 사용.
      return await this.analysisUseCase.analyzeEpisode(
        req.user.sub,
        body.episodeId,
        body.types,
        abortController.signal,
      )
    } finally {
      req.removeListener('close', abort)
      req.removeListener('aborted', abort)
    }
  }

  /** 작품 인덱싱 상태 조회 */
  @UseGuards(JwtAuthGuard)
  @Get('status/:workId')
  async getStatus(@Param('workId') workId: string) {
    return this.analysisUseCase.getIndexStatus(workId)
  }

  /**
   * 분석 히스토리 목록 (최신순, 본인 것만)
   * 응답: AnalysisReportSummary[] (results 미포함, scores 요약만)
   */
  @UseGuards(JwtAuthGuard)
  @Get('reports')
  async listReports(@Req() req: AuthenticatedRequest) {
    return this.analysisUseCase.listReports(req.user.sub)
  }

  /**
   * 분석 리포트 단건 상세 (본인 것만, 소유권 검증)
   * 응답: AnalysisReport (results 포함)
   */
  @UseGuards(JwtAuthGuard)
  @Get('reports/:id')
  async getReport(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.analysisUseCase.getReport(req.user.sub, id)
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
