import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { Theme, AuthorTheme } from '@domain/model/theme'
import { isPlanExpired, SYSTEM_FALLBACK_PRESET } from '@domain/model/plan'

@Injectable()
export class GetThemeUseCase {
  constructor(
    @Inject('ThemeRepositoryPort') private readonly themeRepo: ThemeRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
  ) {}

  /** 작가 기본 테마 조회 — 만기 시 시스템 테마(midnight) 폴백 */
  async execute(authorSlug: string): Promise<Theme> {
    const author = await this.authorRepo.findBySlug(authorSlug)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    // 플랜 만기 → 시스템 테마 폴백
    if (isPlanExpired(author.plan, author.planExpireAt)) {
      return this.getSystemFallback()
    }

    const theme = await this.themeRepo.findByAuthorSlug(authorSlug)
    if (!theme) return this.getSystemFallback()
    return theme
  }

  /** 작품별 테마 resolve — 만기 시 시스템 테마 폴백 */
  async resolve(authorSlug: string, workSlug?: string): Promise<Theme | null> {
    const author = await this.authorRepo.findBySlug(authorSlug)
    if (!author) return null

    if (isPlanExpired(author.plan, author.planExpireAt)) {
      return this.getSystemFallback()
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
    const theme = await this.themeRepo.findByAuthorSlug(authorSlug)
    if (!theme) return this.getSystemFallback()
    return theme
  }

  /** 개별 테마 조회 (소유권 확인) */
  async findById(authorId: string, themeId: string): Promise<Theme> {
    const theme = await this.themeRepo.findById(themeId)
    if (!theme) throw new NotFoundException('테마를 찾을 수 없습니다')
    if (theme.authorId !== authorId) throw new ForbiddenException('본인의 테마만 조회할 수 있습니다')
    return theme
  }

  /** 내 테마 목록 조회 (슬롯 여부 무관 — 대시보드용) */
  async listByAuthor(authorId: string): Promise<Theme[]> {
    return this.themeRepo.findAllByAuthorId(authorId)
  }

  /** 시스템 테마 목록 조회 */
  async listSystemThemes(): Promise<Theme[]> {
    return this.themeRepo.findSystemThemes()
  }

  /** 테마 커스텀 수정 — 시스템 테마(source=system)는 수정 불가 */
  async updateOverrides(authorId: string, themeId: string, overrides?: AuthorTheme, name?: string): Promise<Theme> {
    const theme = await this.themeRepo.findById(themeId)
    if (!theme) throw new NotFoundException('테마를 찾을 수 없습니다')
    if (theme.source === 'system') throw new ForbiddenException('시스템 테마는 수정할 수 없습니다. 복사하여 사용하세요.')
    if (theme.authorId !== authorId) throw new ForbiddenException('본인의 테마만 수정할 수 있습니다')

    return this.themeRepo.update(themeId, theme.preset, overrides ?? theme.overrides!, 'manual_edit', 'user', name)
  }

  /** 테마 삭제 — 시스템 테마 삭제 불가, 활성(슬롯) 테마 삭제 불가 */
  async deleteTheme(authorId: string, themeId: string): Promise<void> {
    const theme = await this.themeRepo.findById(themeId)
    if (!theme) throw new NotFoundException('테마를 찾을 수 없습니다')
    if (theme.source === 'system') throw new ForbiddenException('시스템 테마는 삭제할 수 없습니다')
    if (theme.authorId !== authorId) throw new NotFoundException('테마를 찾을 수 없습니다')
    if (theme.isSlotted) throw new BadRequestException('활성 테마는 슬롯에서 제거 후 삭제하세요')
    await this.themeRepo.delete(themeId)
  }

  /** 작품에 테마 배정 — 소유권 + 슬롯 확인 */
  async assignThemeToWork(authorId: string, workId: string, themeId: string | null): Promise<void> {
    if (themeId) {
      const theme = await this.themeRepo.findById(themeId)
      if (!theme) throw new NotFoundException('테마를 찾을 수 없습니다')
      if (theme.authorId !== authorId) throw new ForbiddenException('본인의 테마만 배정할 수 있습니다')
      if (!theme.isSlotted) throw new BadRequestException('슬롯에 배치된 테마만 작품에 배정할 수 있습니다')
    }
    const targetWork = await this.workRepo.findById(workId)
    if (!targetWork) throw new NotFoundException('작품을 찾을 수 없습니다')
    if (targetWork.authorId !== authorId) throw new ForbiddenException('본인의 작품만 수정할 수 있습니다')

    await this.workRepo.updateWorkThemeId(workId, themeId)
  }

  /** 시스템 폴백 테마 조회 (DB에서 midnight 시스템 테마) */
  private async getSystemFallback(): Promise<Theme> {
    const fallback = await this.themeRepo.findSystemThemeByPreset(SYSTEM_FALLBACK_PRESET)
    if (!fallback) throw new NotFoundException('시스템 테마를 찾을 수 없습니다. DB 마이그레이션을 확인하세요.')
    return fallback
  }
}
