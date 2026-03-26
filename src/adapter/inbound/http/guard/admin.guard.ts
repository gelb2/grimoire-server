import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Inject } from '@nestjs/common'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'

/**
 * 관리자 권한 가드 — JwtAuthGuard 이후에 적용
 * request.user.sub (authorId) 기반으로 DB에서 role 확인
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const userId = request.user?.sub

    if (!userId) {
      throw new ForbiddenException('관리자 권한이 필요합니다')
    }

    const author = await this.authorRepo.findById(userId)
    if (!author || author.role !== 'admin') {
      throw new ForbiddenException('관리자 권한이 필요합니다')
    }

    return true
  }
}
