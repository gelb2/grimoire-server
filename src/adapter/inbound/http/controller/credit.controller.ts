import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Get, Post, Body, UseGuards, Req, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import {
  CreditBalanceResponseDto,
  CreditLogsQueryDto,
  toCreditBalanceResponse,
} from '@adapter/inbound/http/dto/credit.dto'

@Controller('credits')
export class CreditController {
  constructor(private readonly creditUseCase: CreditUseCase) {}

  /** 크레딧 선물 (독자 → 작가) */
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UseGuards(JwtAuthGuard)
  @Post('gift')
  async gift(@Req() req: AuthenticatedRequest, @Body() body: { receiverId: string; amount: number }) {
    return this.creditUseCase.gift(req.user.sub, body.receiverId, body.amount)
  }

  /** 응원받는 작가 랭킹 (공개) */
  @Get('ranking')
  async getGiftRanking(@Query('limit') limit?: string) {
    return this.creditUseCase.getGiftRanking(limit ? parseInt(limit, 10) : 10)
  }

  /** 크레딧 잔액 조회 — 크레딧 개편 I Phase: 4 출처 포인트 잔액 (free/subscription/gift/charged + deficit) */
  @UseGuards(JwtAuthGuard)
  @Get('balance')
  async getBalance(@Req() req: AuthenticatedRequest): Promise<CreditBalanceResponseDto> {
    return toCreditBalanceResponse(await this.creditUseCase.getPointBalance(req.user.sub))
  }

  /**
   * 크레딧 로그 조회 — F-21: 기간(from/to) + 오프셋 페이지네이션(limit/offset) Optional.
   * 무파라미터 호출 시 기존 동작(최신순 100건). 응답은 `CreditLedgerEntry[]` 배열 유지(web 계약 미파손).
   */
  @UseGuards(JwtAuthGuard)
  @Get('logs')
  async getLogs(@Req() req: AuthenticatedRequest, @Query() query: CreditLogsQueryDto) {
    return this.creditUseCase.getLogs(req.user.sub, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      offset: query.offset,
    })
  }

  /**
   * 구독 풀 만료 예정 요약 — F-21 (brightMall #1). 활성 유료 구독의 다음 리셋일 소멸 예정 pt.
   * 만료 예정 없음(free/미구독/잔액0)이면 null. 잔액 응답 확장 대신 경량 신규 GET(하위호환 안전).
   */
  @UseGuards(JwtAuthGuard)
  @Get('expiring')
  async getExpiring(@Req() req: AuthenticatedRequest) {
    return this.creditUseCase.getSubscriptionExpiry(req.user.sub)
  }
}
