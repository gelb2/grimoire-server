import { Injectable, Inject, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import * as crypto from 'crypto'
import { OAuth2Client } from 'google-auth-library'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { AuthTokenRepositoryPort } from '@domain/port/outbound/auth-token-repository.port'
import { SignupHistoryRepositoryPort } from '@domain/port/outbound/signup-history-repository.port'

const REFRESH_TOKEN_EXPIRY_DAYS = 7

@Injectable()
export class AuthUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    private readonly jwtService: JwtService,
    private readonly creditUseCase: CreditUseCase,
    @Inject('AuthTokenRepositoryPort') private readonly authTokenRepo: AuthTokenRepositoryPort,
    @Inject('SignupHistoryRepositoryPort') private readonly signupHistoryRepo: SignupHistoryRepositoryPort,
  ) {}

  /** 새 작가 등록 */
  async register(input: { email: string; password: string; name: string; slug: string }) {
    // 이메일 중복 검사
    const existing = await this.authorRepo.findByEmail(input.email)
    if (existing) {
      throw new BadRequestException('이미 가입된 이메일입니다')
    }

    // 슬러그 중복 검사
    const existingSlug = await this.authorRepo.findBySlug(input.slug)
    if (existingSlug) {
      throw new BadRequestException('이미 사용 중인 슬러그입니다')
    }

    // 재가입 방지 — 이전 가입 이력이 있으면 차단
    const signupHistory = await this.signupHistoryRepo.findByProviderId(input.email)
    if (signupHistory && signupHistory.signupCount >= 2) {
      throw new BadRequestException('이 이메일로는 더 이상 가입할 수 없습니다')
    }

    // 비밀번호 해싱
    const passwordHash = await bcrypt.hash(input.password, 10)

    // 작가 생성
    const author = await this.authorRepo.create({
      email: input.email,
      name: input.name,
      slug: input.slug,
      passwordHash,
    })

    // 가입 보너스 크레딧 (DB 기본값 0 + grant 3 = 총 3)
    await this.creditUseCase.grant(author.id, 3, 'signup_bonus')

    // 가입 이력 기록 (재가입 방지용)
    await this.signupHistoryRepo.upsert(input.email)

    // 토큰 발급
    const accessToken = this.generateAccessToken(author)
    const refreshToken = await this.createRefreshToken(author.id)

    return { author, accessToken, refreshToken }
  }

  /** 이메일 + 비밀번호 로그인 */
  async login(input: { email: string; password: string }) {
    const author = await this.authorRepo.findByEmail(input.email)
    if (!author || !author.passwordHash) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다')
    }

    const valid = await bcrypt.compare(input.password, author.passwordHash)
    if (!valid) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다')
    }

    const accessToken = this.generateAccessToken(author)
    const refreshToken = await this.createRefreshToken(author.id)
    return { author, accessToken, refreshToken }
  }

  /** Google OAuth 로그인 */
  async googleLogin(googleToken: string) {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

    const ticket = await client.verifyIdToken({
      idToken: googleToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
    const payload = ticket.getPayload()
    if (!payload?.email) throw new UnauthorizedException('Google 인증 실패')

    // 이미 소셜 계정으로 연결된 유저 찾기
    let author = await this.authorRepo.findBySocialAccount('google', payload.sub!)

    if (!author) {
      // 이메일로 기존 유저 찾기
      author = await this.authorRepo.findByEmail(payload.email)

      if (!author) {
        // 재가입 방지
        const googleHistory = await this.signupHistoryRepo.findByProviderId(payload.sub!)
        if (googleHistory && googleHistory.signupCount >= 2) {
          throw new BadRequestException('이 계정으로는 더 이상 가입할 수 없습니다')
        }

        // 신규 가입 — 슬러그 충돌 시 랜덤 4자리 접미사 추가
        let slug = payload.email.split('@')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const existingSlug = await this.authorRepo.findBySlug(slug)
        if (existingSlug) {
          slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`
        }
        author = await this.authorRepo.create({
          email: payload.email,
          name: payload.name || payload.email.split('@')[0],
          slug,
        })
        await this.creditUseCase.grant(author.id, 3, 'signup_bonus')

        // 가입 이력 기록
        await this.signupHistoryRepo.upsert(payload.sub!)
      }

      // 소셜 계정 연결
      await this.authorRepo.linkSocialAccount(author.id, 'google', payload.sub!, payload.email)
    }

    const accessToken = this.generateAccessToken(author)
    const refreshToken = await this.createRefreshToken(author.id)
    return { author, accessToken, refreshToken }
  }

  /** Refresh Token으로 새 Access Token 발급 */
  async refreshAccessToken(refreshTokenValue: string) {
    const tokenHash = this.hashToken(refreshTokenValue)
    const stored = await this.authTokenRepo.findByHash(tokenHash)

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다')
    }

    const author = await this.authorRepo.findById(stored.authorId)
    if (!author) throw new UnauthorizedException('작가를 찾을 수 없습니다')

    // 기존 refresh token 무효화 (rotation)
    await this.authTokenRepo.revoke(stored.id)

    // 새 토큰 쌍 발급
    const accessToken = this.generateAccessToken(author)
    const newRefreshToken = await this.createRefreshToken(author.id)

    return { author, accessToken, refreshToken: newRefreshToken }
  }

  /** 로그아웃 — Refresh Token 무효화 */
  async revokeRefreshToken(refreshTokenValue?: string, authorId?: string) {
    if (refreshTokenValue) {
      const tokenHash = this.hashToken(refreshTokenValue)
      await this.authTokenRepo.revokeByHash(tokenHash)
    }
    if (authorId) {
      await this.authTokenRepo.revokeAllByAuthorId(authorId)
    }
  }

  /** 프로필 조회 */
  async getProfile(authorId: string) {
    const author = await this.authorRepo.findById(authorId)
    if (!author) {
      throw new BadRequestException('작가를 찾을 수 없습니다')
    }
    return author
  }

  /** 비밀번호 변경 */
  async changePassword(authorId: string, currentPassword: string, newPassword: string): Promise<void> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new BadRequestException('작가를 찾을 수 없습니다')
    if (!author.passwordHash) throw new BadRequestException('소셜 로그인 계정은 비밀번호를 변경할 수 없습니다')

    const isMatch = await bcrypt.compare(currentPassword, author.passwordHash)
    if (!isMatch) throw new UnauthorizedException('현재 비밀번호가 올바르지 않습니다')

    if (newPassword.length < 6) throw new BadRequestException('새 비밀번호는 6자 이상이어야 합니다')

    const newHash = await bcrypt.hash(newPassword, 10)
    await this.authorRepo.updatePasswordHash(authorId, newHash)
  }

  /** Access Token 생성 (15분) */
  private generateAccessToken(author: { id: string; slug: string; role: string }): string {
    return this.jwtService.sign({ sub: author.id, slug: author.slug, role: author.role })
  }

  /** Refresh Token 생성 + DB 저장 (7일) */
  private async createRefreshToken(authorId: string): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = this.hashToken(rawToken)
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

    await this.authTokenRepo.create(authorId, tokenHash, expiresAt)

    return rawToken
  }

  /** 토큰 SHA-256 해시 */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex')
  }
}
