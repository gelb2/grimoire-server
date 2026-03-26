import { Injectable, Inject, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditUseCase } from '@application/credit/credit.usecase'

@Injectable()
export class AuthUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    private readonly jwtService: JwtService,
    private readonly creditUseCase: CreditUseCase,
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

    // 비밀번호 해싱
    const passwordHash = await bcrypt.hash(input.password, 10)

    // 작가 생성
    const author = await this.authorRepo.create({
      email: input.email,
      name: input.name,
      slug: input.slug,
      passwordHash,
    })

    // 가입 보너스 크레딧 (이미 기본값 3이지만 로그 기록)
    await this.creditUseCase.grant(author.id, 3, 'signup_bonus')

    // JWT 발급
    const token = this.jwtService.sign({ sub: author.id, slug: author.slug, role: author.role })

    return { author, token }
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

    const token = this.jwtService.sign({ sub: author.id, slug: author.slug, role: author.role })
    return { author, token }
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
      }

      // 소셜 계정 연결
      await this.authorRepo.linkSocialAccount(author.id, 'google', payload.sub!, payload.email)
    }

    const token = this.jwtService.sign({ sub: author.id, slug: author.slug, role: author.role })
    return { author, token }
  }

  /** 프로필 조회 */
  async getProfile(authorId: string) {
    const author = await this.authorRepo.findById(authorId)
    if (!author) {
      throw new BadRequestException('작가를 찾을 수 없습니다')
    }
    return author
  }
}
