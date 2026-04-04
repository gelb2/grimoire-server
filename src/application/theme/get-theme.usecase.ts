import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { Theme, AuthorTheme } from '@domain/model/theme'
import { isPlanExpired, SYSTEM_DEFAULT_THEME } from '@domain/model/plan'

@Injectable()
export class GetThemeUseCase {
  constructor(
    @Inject('ThemeRepositoryPort') private readonly themeRepo: ThemeRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
  ) {}

  /** 작가 기본 테마 조회 — 만기 시 시스템 기본테마 반환 */
  async execute(authorSlug: string): Promise<Theme> {
    const author = await this.authorRepo.findBySlug(authorSlug)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    // 플랜 만기 → 시스템 기본테마
    if (isPlanExpired(author.plan, author.planExpireAt)) {
      return SYSTEM_DEFAULT_THEME
    }

    const theme = await this.themeRepo.findByAuthorSlug(authorSlug)
    if (!theme) return SYSTEM_DEFAULT_THEME
    return theme
  }

  /** 작품별 테마 resolve — 만기 시 시스템 기본테마 */
  async resolve(authorSlug: string, workSlug?: string): Promise<Theme | null> {
    const author = await this.authorRepo.findBySlug(authorSlug)
    if (!author) return null

    if (isPlanExpired(author.plan, author.planExpireAt)) {
      return SYSTEM_DEFAULT_THEME
    }

    // 작품 지정 시 작품 테마 우선
    if (workSlug) {
      const work = await this.workRepo.findByAuthorAndWorkSlug(authorSlug, workSlug)
      if (work?.themeId) {
        const workTheme = await this.themeRepo.findById(work.themeId)
        if (workTheme?.isSlotted) return workTheme
      }
    }
    // 작가 기본 테마
    return this.themeRepo.findByAuthorSlug(authorSlug)
  }

  /** 내 테마 목록 조회 (슬롯 여부 무관 — 대시보드용) */
  async listByAuthor(authorId: string): Promise<Theme[]> {
    return this.themeRepo.findAllByAuthorId(authorId)
  }

  /** 테마 커스텀 수정 */
  async updateOverrides(authorId: string, themeId: string, overrides: AuthorTheme): Promise<Theme> {
    const theme = await this.themeRepo.findById(themeId)
    if (!theme) throw new NotFoundException('테마를 찾을 수 없습니다')
    if (theme.authorId !== authorId) throw new ForbiddenException('본인의 테마만 수정할 수 있습니다')

    return this.themeRepo.update(themeId, 'custom', overrides, 'manual_edit')
  }

  /** 테마 삭제 */
  async deleteTheme(authorId: string, themeId: string): Promise<void> {
    const theme = await this.themeRepo.findById(themeId)
    if (!theme) throw new NotFoundException('테마를 찾을 수 없습니다')
    if (theme.authorId !== authorId) throw new NotFoundException('테마를 찾을 수 없습니다')
    await this.themeRepo.delete(themeId)
  }
}
