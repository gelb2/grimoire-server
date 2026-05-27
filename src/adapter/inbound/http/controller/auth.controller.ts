import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import { Controller, Post, Body, Get, Req, Res, UseGuards, ForbiddenException, Inject, Logger, Optional } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Request, Response } from 'express'
import { AuthUseCase } from '@application/auth/auth.usecase'
import { EmailVerificationUseCase } from '@application/auth/email-verification.usecase'
import { RegisterDto, LoginDto, PasswordResetRequestDto, TokenConfirmDto } from '@adapter/inbound/http/dto/auth.dto'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { verifyRecaptcha } from '@adapter/inbound/http/util/recaptcha-verifier'
import { AccessLogService } from '@infrastructure/security/access-log.service'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { isRemoteEnv } from '@infrastructure/config/app-env'
import { CreditLedgerPort } from '@domain/port/outbound/credit-ledger.port'

/** 쿠키 상수 */
const ACCESS_COOKIE = 'grimoire_token'
const REFRESH_COOKIE = 'grimoire_refresh'
const ACCESS_MAX_AGE = 15 * 60 * 1000         // 15분
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000  // 7일

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    // HTTPS를 쓰는 모든 원격 환경(dev/prod)에서 secure=true.
    // 과거 NODE_ENV==='production' 체크는 암묵적 의존성이라 APP_ENV 기반으로 전환.
    secure: isRemoteEnv(),
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  }
}

function setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_MAX_AGE))
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_MAX_AGE))
}

function clearTokenCookies(res: Response) {
  res.cookie(ACCESS_COOKIE, '', cookieOptions(0))
  res.cookie(REFRESH_COOKIE, '', cookieOptions(0))
}

function extractClientInfo(req: Request) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || undefined
  const userAgent = req.headers['user-agent'] || undefined
  return { ip, userAgent }
}

/**
 * 인증 응답 작가 직렬화 — 案 P3-Y + 옵션 A (CC-4 Phase 3, 2026-05-21).
 *
 * `Author.credits` 컬럼 DROP 후에도 `/auth/me`·`/auth/profile`·`/auth/login`·`/auth/register`·`/auth/google`·
 * `/auth/refresh` 응답 키 `credits` 는 외부 호환성을 위해 **보존** (web `AuthUser.credits`/`PlatformNav.tsx`/admin authors 영향 회피).
 * 값은 신 `CreditLedgerPort.getBalance().total`(4 출처 합 pt) 매핑 — 옵션 A. ledger 미주입/조회 실패 시 0 폴백(안전망).
 *
 * 정본: .claude/state/sprint-cc4-phase3-drop-plan-draft.md §2-3 案 P3-Y 옵션 A
 *       .claude/shared-contracts.md §30 CreditOverhaul (변경 이력 박제)
 */
function userResponse(
  author: { id: string; slug: string; name: string; email: string; role: string; bio?: string | null },
  credits: number,
) {
  return { id: author.id, slug: author.slug, name: author.name, email: author.email, credits, role: author.role, bio: author.bio ?? undefined }
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name)

  constructor(
    private readonly authUseCase: AuthUseCase,
    private readonly accessLog: AccessLogService,
    private readonly prisma: PrismaService,
    /**
     * CC-4 Phase 3 (2026-05-21) — `Author.credits` DROP 정합. 응답 `credits` 값을 신 ledger 잔액으로 매핑.
     * Optional — 미주입 시 0 폴백(BACKWARD COMPATIBLE, 안전망 — 실 운영에서는 항상 주입).
     */
    @Optional()
    @Inject('CreditLedgerPort')
    private readonly creditLedger: CreditLedgerPort | null = null,
    /**
     * EMAIL-POLAR-READY Phase C (2026-05-27) — 이메일 인증/비밀번호 초기화 토큰 발급/검증.
     * Optional — 미주입 시 4 endpoint 503 폴백 (회귀 보존). 실 운영은 app.module 주입.
     */
    @Optional()
    private readonly emailVerification: EmailVerificationUseCase | null = null,
  ) {}

  /**
   * 案 P3-Y 옵션 A — 응답 `credits` 값을 신 ledger 4 출처 합(total)으로 매핑.
   * ledger 미주입 또는 throw 시 0 폴백 (silent log, 응답 자체는 항상 성공 — lazy 안전망 패턴 정합).
   */
  private async resolveCredits(authorId: string): Promise<number> {
    if (!this.creditLedger) return 0
    try {
      const balance = await this.creditLedger.getBalance(authorId)
      return balance.total
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.warn(`credits 응답 매핑 실패 (ledger.getBalance throw, authorId=${authorId}, fallback=0): ${msg}`)
      return 0
    }
  }

  @Throttle({ default: { ttl: 3600000, limit: 5 } })  // 시간당 5회
  @Post('register')
  async register(
    @Body() dto: RegisterDto & { recaptchaToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await verifyRecaptcha(dto.recaptchaToken || '')
    const { author, accessToken, refreshToken } = await this.authUseCase.register(dto)
    setTokenCookies(res, accessToken, refreshToken)

    const { ip, userAgent } = extractClientInfo(req)
    await this.accessLog.log({ action: 'register', authorId: author.id, email: dto.email, ip, userAgent })

    return { user: userResponse(author, await this.resolveCredits(author.id)) }
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Post('login')
  async login(
    @Body() dto: LoginDto & { recaptchaToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await verifyRecaptcha(dto.recaptchaToken || '')
    const { ip, userAgent } = extractClientInfo(req)

    // EMAIL-P0-3: identifier 통합 박제 — slug 로그인 시 slug, email 로그인 시 email
    // AccessLog.email 컬럼은 schema 변경 0건 정책으로 양립 사용 (identifier 통합), detail에 type 박제
    const identifier = dto.email ?? dto.slug ?? ''
    const identifierType: 'email' | 'slug' = dto.email ? 'email' : 'slug'

    try {
      const { author, accessToken, refreshToken } = await this.authUseCase.login(dto)

      // 제재 확인 — 만료된 제재 자동 해제 후 활성 제재 확인
      await this.prisma.userSanction.updateMany({
        where: { authorId: author.id, isActive: true, endAt: { not: null, lt: new Date() } },
        data: { isActive: false },
      })
      const sanction = await this.prisma.userSanction.findFirst({
        where: { authorId: author.id, isActive: true },
      })
      if (sanction) {
        await this.accessLog.log({ action: 'login_blocked', authorId: author.id, email: identifier, ip, userAgent, detail: `sanction:${sanction.type};identifierType:${identifierType}` })
        throw new ForbiddenException(`계정이 정지되었습니다. 사유: ${sanction.reason}${sanction.endAt ? ` (해제: ${sanction.endAt.toISOString().split('T')[0]})` : ' (영구)'}`)
      }

      setTokenCookies(res, accessToken, refreshToken)
      await this.accessLog.log({ action: 'login_success', authorId: author.id, email: identifier, ip, userAgent, detail: `identifierType:${identifierType}` })

      return { user: userResponse(author, await this.resolveCredits(author.id)) }
    } catch (err) {
      await this.accessLog.log({ action: 'login_fail', email: identifier, ip, userAgent, detail: `${(err as Error).message};identifierType:${identifierType}` })
      throw err
    }
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Post('google')
  async googleLogin(
    @Body() body: { token: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { ip, userAgent } = extractClientInfo(req)
    const { author, accessToken, refreshToken } = await this.authUseCase.googleLogin(body.token)
    setTokenCookies(res, accessToken, refreshToken)

    await this.accessLog.log({ action: 'login_success', authorId: author.id, email: author.email, ip, userAgent, detail: 'google_oauth' })

    return { user: userResponse(author, await this.resolveCredits(author.id)) }
  }

  @Throttle({ default: { ttl: 60000, limit: 30 } })  // 분당 30회 (자동 갱신 고려)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshTokenValue = req.cookies?.[REFRESH_COOKIE]
    if (!refreshTokenValue) {
      throw new ForbiddenException('리프레시 토큰이 없습니다')
    }

    const { author, accessToken, refreshToken } = await this.authUseCase.refreshAccessToken(refreshTokenValue)
    setTokenCookies(res, accessToken, refreshToken)

    return { user: userResponse(author, await this.resolveCredits(author.id)) }
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshTokenValue = req.cookies?.[REFRESH_COOKIE]
    await this.authUseCase.revokeRefreshToken(refreshTokenValue)
    clearTokenCookies(res)
    return { loggedOut: true }
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async profile(@Req() req: AuthenticatedRequest) {
    const author = await this.authUseCase.getProfile(req.user.sub)
    return userResponse(author, await this.resolveCredits(author.id))
  }

  @Throttle({ default: { ttl: 3600000, limit: 5 } })  // 시간당 5회
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @Req() req: AuthenticatedRequest & Request,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    await this.authUseCase.changePassword(req.user.sub, body.currentPassword, body.newPassword)

    const { ip, userAgent } = extractClientInfo(req as Request)
    await this.accessLog.log({ action: 'password_change', authorId: req.user.sub, ip, userAgent })

    return { success: true }
  }

  /**
   * EMAIL-POLAR-READY Phase C (2026-05-27) — 이메일 인증 토큰 발급 요청 (본인 인증 후).
   *
   * 사용자 절대 규정 0-1 정합:
   * - EMAIL_PROVIDER=null (default) 시 NullEmailAdapter → 토큰 DB 박제 정상, 외부 발송 0
   * - EMAIL_PROVIDER=resend/sendgrid 시 실 발송
   *
   * Throttle: 분당 3회 — 발송 spam + DB 토큰 누적 방지.
   */
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @UseGuards(JwtAuthGuard)
  @Post('email/verify-request')
  async emailVerifyRequest(@Req() req: AuthenticatedRequest) {
    if (!this.emailVerification) {
      throw new ForbiddenException('이메일 인증 시스템이 아직 활성화되지 않았습니다')
    }
    const result = await this.emailVerification.sendVerification(req.user.sub)

    const { ip, userAgent } = extractClientInfo(req as unknown as Request)
    await this.accessLog.log({
      action: 'email_verify_request',
      authorId: req.user.sub,
      ip,
      userAgent,
      detail: `provider:${result.provider}`,
    })

    return { issued: result.issued, provider: result.provider }
  }

  /**
   * EMAIL-POLAR-READY Phase C — 이메일 인증 토큰 검증 (본인 인증 후).
   *
   * 토큰 검증 성공 시 redeem 표식 박제 (재사용 차단).
   * 응답: { verified: true, email } — Author.emailVerifiedAt 컬럼 갱신은 별 sprint (스키마 변경 1건 제약).
   */
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UseGuards(JwtAuthGuard)
  @Post('email/verify-confirm')
  async emailVerifyConfirm(
    @Body() dto: TokenConfirmDto,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!this.emailVerification) {
      throw new ForbiddenException('이메일 인증 시스템이 아직 활성화되지 않았습니다')
    }
    const result = await this.emailVerification.verifyToken(dto.token)
    // 본인 토큰 검증 — JWT sub와 token.authorId 일치 검증 (계정 탈취 차단)
    if (result.authorId !== req.user.sub) {
      throw new ForbiddenException('본인의 토큰만 검증할 수 있습니다')
    }

    const { ip, userAgent } = extractClientInfo(req as unknown as Request)
    await this.accessLog.log({
      action: 'email_verify_confirm',
      authorId: req.user.sub,
      ip,
      userAgent,
      detail: `purpose:${result.purpose}`,
    })

    return { verified: true, email: result.email, purpose: result.purpose }
  }

  /**
   * EMAIL-POLAR-READY Phase C — 비밀번호 초기화 요청 (비로그인 호출 가능).
   *
   * enumeration 차단 — 등록 여부와 무관하게 동일 응답.
   * Throttle: 분당 3회 — 무차별 대입 차단.
   */
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('password/reset-request')
  async passwordResetRequest(
    @Body() dto: PasswordResetRequestDto,
    @Req() req: Request,
  ) {
    if (!this.emailVerification) {
      throw new ForbiddenException('비밀번호 초기화 시스템이 아직 활성화되지 않았습니다')
    }
    const result = await this.emailVerification.sendPasswordReset(dto.email)

    const { ip, userAgent } = extractClientInfo(req)
    await this.accessLog.log({
      action: 'password_reset_request',
      email: dto.email,
      ip,
      userAgent,
      detail: `provider:${result.provider}`,
    })

    return { issued: result.issued }
  }

  /**
   * EMAIL-POLAR-READY Phase C — 비밀번호 초기화 토큰 검증 + 신 비밀번호 설정.
   *
   * 본 sprint에서는 토큰 검증만 박제 — Author.passwordHash 갱신은 별 sprint 진입 시
   * verify → reset 2단계 분리 또는 본 endpoint 확장.
   * 현 응답: { verified: true, email } — 호출자가 다음 step 결정.
   */
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('password/reset-confirm')
  async passwordResetConfirm(
    @Body() dto: TokenConfirmDto,
    @Req() req: Request,
  ) {
    if (!this.emailVerification) {
      throw new ForbiddenException('비밀번호 초기화 시스템이 아직 활성화되지 않았습니다')
    }
    const result = await this.emailVerification.verifyToken(dto.token)
    if (result.purpose !== 'password_reset') {
      throw new ForbiddenException('비밀번호 초기화 토큰이 아닙니다')
    }

    const { ip, userAgent } = extractClientInfo(req)
    await this.accessLog.log({
      action: 'password_reset_confirm',
      email: result.email,
      ip,
      userAgent,
    })

    return { verified: true, email: result.email }
  }
}
