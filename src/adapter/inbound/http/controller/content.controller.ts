import { Controller, Get, Param, Req, UseGuards, Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ContentUseCase } from '@application/content/content.usecase'
import { WorkManagementUseCase } from '@application/work/work-management.usecase'
import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'

/** JWT 선택적 가드 — 토큰 있으면 파싱, 없어도 통과 */
@Injectable()
class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    let token: string | undefined

    const authHeader = request.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }
    if (!token && request.cookies?.grimoire_token) {
      token = request.cookies.grimoire_token
    }

    if (token) {
      try {
        request.user = this.jwtService.verify(token)
      } catch {
        // 토큰 유효하지 않아도 통과 — user가 undefined
      }
    }
    return true
  }
}

@Controller()
export class ContentController {
  constructor(
    private readonly contentUseCase: ContentUseCase,
    private readonly workManagementUseCase: WorkManagementUseCase,
  ) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get('works/:authorSlug/:workSlug')
  async getWork(
    @Req() req: AuthenticatedRequest,
    @Param('authorSlug') authorSlug: string,
    @Param('workSlug') workSlug: string,
  ) {
    const requestAuthorId = req.user?.sub
    return this.contentUseCase.getWorkDetail(authorSlug, workSlug, requestAuthorId)
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('episodes/:authorSlug/:workSlug/:episodeSlug')
  async getEpisode(
    @Req() req: AuthenticatedRequest,
    @Param('authorSlug') authorSlug: string,
    @Param('workSlug') workSlug: string,
    @Param('episodeSlug') episodeSlug: string,
  ) {
    const requestAuthorId = req.user?.sub
    const episode = await this.contentUseCase.getEpisode(authorSlug, workSlug, episodeSlug, requestAuthorId)
    // 내부 필드 제거 — rawMd(원본 마크다운), workId(내부 UUID) 미노출
    const { rawMd, workId, sharedToken, sharedExpireAt, ...safe } = episode as any
    return safe
  }

  /** 공유 링크 접근 — 비로그인 가능 */
  @Get('shared/:token')
  async getSharedEpisode(@Param('token') token: string) {
    const episode = await this.workManagementUseCase.getEpisodeBySharedToken(token)
    // 내부 필드 제거
    const { rawMd, workId, sharedToken, sharedExpireAt, ...safe } = episode as any
    return safe
  }
}
