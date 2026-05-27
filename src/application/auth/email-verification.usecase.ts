import { Injectable, Inject, BadRequestException, Logger, NotFoundException } from '@nestjs/common'
import { EmailVerificationTokenRepositoryPort } from '@domain/port/outbound/email-verification-token-repository.port'
import { EmailServicePort } from '@domain/port/outbound/email-service.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import {
  calculateExpireAt,
  EmailTokenPurpose,
  generatePlainToken,
  hashToken,
  isTokenUsable,
} from '@domain/model/email-verification-token'

/**
 * EmailVerificationUseCase — 이메일 인증/비밀번호 초기화 토큰 발급/검증 (EMAIL-POLAR-READY Phase C).
 *
 * 정본: `.claude/state/sprint-email-polar-ready-plan-draft.md` §7
 *
 * 사용자 절대 규정 0-1 정합:
 * - EmailServicePort 가 NullEmailAdapter 인 경우 (default) — 토큰 발급/DB 박제는 정상 진행, 발송만 logger.warn
 * - ResendEmailAdapter / SendgridEmailAdapter 활성 시에만 실 발송
 * - 어느 경우든 본 usecase 코드 변경 0 (인터페이스 추상화)
 *
 * 보안:
 * - 평문 토큰은 sendXxx 응답에 박제 (E2E spec 검증용), DB 0건 (hash만)
 * - 토큰 hash 충돌 시 P2002 → 호출자에 throw (재시도 책임)
 * - 검증 실패는 일관된 메시지("토큰이 유효하지 않습니다") — 정보 누출 차단
 */
@Injectable()
export class EmailVerificationUseCase {
  private readonly logger = new Logger(EmailVerificationUseCase.name)

  constructor(
    @Inject('EmailVerificationTokenRepositoryPort')
    private readonly tokenRepo: EmailVerificationTokenRepositoryPort,
    @Inject('EmailServicePort') private readonly emailService: EmailServicePort,
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
  ) {}

  /**
   * 이메일 인증 토큰 발급 + 발송.
   *
   * @param authorId 본인 인증된 작가 ID (JwtAuthGuard 통과)
   * @returns { issued: true } — 발송 결과는 logger 박제, 본 응답은 멱등성을 위해 항상 success (정보 누출 차단)
   */
  async sendVerification(authorId: string): Promise<{ issued: boolean; provider: string }> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) {
      throw new NotFoundException('작가를 찾을 수 없습니다')
    }

    return this.issueAndSend({
      authorId: author.id,
      email: author.email,
      displayName: author.name,
      purpose: 'verify_email',
    })
  }

  /**
   * 비밀번호 초기화 토큰 발급 + 발송 (비로그인 사용자도 호출 가능).
   *
   * 보안 — 응답은 이메일 존재 여부와 무관하게 동일 (enumeration 차단):
   * - 등록된 이메일 → 토큰 발송 (NullAdapter면 logger.warn)
   * - 미등록 이메일 → 발송 0, but 응답 동일
   */
  async sendPasswordReset(email: string): Promise<{ issued: boolean; provider: string }> {
    const author = await this.authorRepo.findByEmail(email)
    if (!author) {
      // enumeration 차단 — 미등록 이메일도 동일 응답
      this.logger.warn(`[EmailVerificationUseCase] sendPasswordReset 호출 — 미등록 이메일 (응답 동일, enumeration 차단)`)
      return { issued: true, provider: this.emailService.getProviderName() }
    }

    return this.issueAndSend({
      authorId: author.id,
      email: author.email,
      displayName: author.name,
      purpose: 'password_reset',
    })
  }

  /**
   * 토큰 검증 + redeem.
   *
   * @returns { authorId, email, purpose } — 호출자(controller)가 후속 흐름 결정 (Author.emailVerifiedAt 갱신은 별 sprint)
   */
  async verifyToken(plainToken: string): Promise<{
    authorId: string
    email: string
    purpose: EmailTokenPurpose
  }> {
    if (!plainToken || typeof plainToken !== 'string') {
      throw new BadRequestException('토큰이 유효하지 않습니다')
    }
    const tokenHash = hashToken(plainToken)
    const token = await this.tokenRepo.findByTokenHash(tokenHash)
    if (!token) {
      throw new BadRequestException('토큰이 유효하지 않습니다')
    }
    const usable = isTokenUsable(token)
    if (!usable.usable) {
      throw new BadRequestException(
        usable.reason === 'expired' ? '토큰이 만료되었습니다' : '이미 사용된 토큰입니다',
      )
    }
    // redeem 표식
    await this.tokenRepo.markRedeemed(token.id, new Date())
    return {
      authorId: token.authorId,
      email: token.email,
      purpose: token.purpose,
    }
  }

  /** 공통 발급/발송 흐름 — verify_email / password_reset 양 분기 통합 */
  private async issueAndSend(input: {
    authorId: string
    email: string
    displayName: string
    purpose: EmailTokenPurpose
  }): Promise<{ issued: boolean; provider: string }> {
    const plainToken = generatePlainToken()
    const tokenHash = hashToken(plainToken)
    const expireAt = calculateExpireAt(input.purpose)

    // DB 박제 — 평문 토큰은 메모리만, hash만 DB
    await this.tokenRepo.create({
      authorId: input.authorId,
      email: input.email,
      tokenHash,
      purpose: input.purpose,
      expireAt,
    })

    // 발송 — NullAdapter 시 logger.warn만 (외부 호출 0)
    const result =
      input.purpose === 'verify_email'
        ? await this.emailService.sendVerificationEmail({
            to: input.email,
            token: plainToken,
            displayName: input.displayName,
            expireAt,
          })
        : await this.emailService.sendPasswordResetEmail({
            to: input.email,
            token: plainToken,
            displayName: input.displayName,
            expireAt,
          })

    this.logger.log(
      `[EmailVerificationUseCase] ${input.purpose} 토큰 발급 — authorId=${input.authorId} provider=${result.provider} messageId=${result.messageId ?? 'null'}`,
    )

    return { issued: true, provider: result.provider }
  }
}
