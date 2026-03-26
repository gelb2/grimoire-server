import { Injectable, Inject, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
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
    const token = this.jwtService.sign({ sub: author.id, slug: author.slug })

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

    const token = this.jwtService.sign({ sub: author.id, slug: author.slug })
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
