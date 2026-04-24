import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { Theme } from '@domain/model/theme'
import { THEME_SLOT_LIMITS } from '@domain/model/config'
import { isPlanExpired } from '@domain/model/plan'

@Injectable()
export class ThemeSlotUseCase {
  constructor(
    @Inject('ThemeRepositoryPort') private readonly themeRepo: ThemeRepositoryPort,
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
  ) {}

  /** 테마를 활성 슬롯에 배치 — 슬롯 비었으면 자동 활성화 */
  async assignSlot(authorId: string, themeId: string): Promise<Theme> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    if (isPlanExpired(author.plan, author.planExpireAt)) {
      throw new ForbiddenException('구독 플랜이 만료되었습니다. 플랜을 갱신하세요.')
    }

    const theme = await this.themeRepo.findById(themeId)
    if (!theme) throw new NotFoundException('테마를 찾을 수 없습니다')
    if (theme.authorId !== authorId) throw new ForbiddenException('본인의 테마만 슬롯에 배치할 수 있습니다')
    if (theme.source === 'system') throw new ForbiddenException('시스템 테마는 슬롯에 배치할 수 없습니다')

    if (theme.isSlotted) {
      throw new BadRequestException('이미 슬롯에 배치된 테마입니다')
    }

    // 슬롯 용량 체크
    const slotLimit = THEME_SLOT_LIMITS[author.plan] ?? 1
    const slottedCount = await this.themeRepo.countSlottedByAuthorId(authorId)
    if (slottedCount >= slotLimit) {
      throw new BadRequestException(
        `테마 슬롯이 가득 찼습니다 (${slottedCount}/${slotLimit}). 다른 테마를 슬롯에서 제거하세요.`,
      )
    }

    const slotted = await this.themeRepo.updateSlotStatus(themeId, true)

    // 첫 슬롯이면 자동 활성화
    if (slottedCount === 0) {
      await this.authorRepo.updateDefaultThemeId(authorId, themeId)
    }

    return slotted
  }

  /** 테마를 슬롯에서 제거 (보관 상태로) — defaultThemeId 정리 */
  async removeFromSlot(authorId: string, themeId: string): Promise<Theme> {
    const theme = await this.themeRepo.findById(themeId)
    if (!theme) throw new NotFoundException('테마를 찾을 수 없습니다')
    if (theme.authorId !== authorId) throw new ForbiddenException('본인의 테마만 제거할 수 있습니다')

    if (!theme.isSlotted) {
      throw new BadRequestException('슬롯에 배치되지 않은 테마입니다')
    }

    const removed = await this.themeRepo.updateSlotStatus(themeId, false)

    // 활성 테마가 제거된 경우 → 남은 슬롯 첫 번째로 교체, 없으면 null
    const author = await this.authorRepo.findById(authorId)
    if (author?.defaultThemeId === themeId) {
      const remaining = await this.themeRepo.findSlottedByAuthorId(authorId)
      await this.authorRepo.updateDefaultThemeId(authorId, remaining.length > 0 ? remaining[0].id : null)
    }

    return removed
  }

  /**
   * 테마를 작가 공간의 기본 테마로 활성화 — 슬롯 상태 자동 관리
   *
   * 2026-04-24 개선: 슬롯이 가득 찬 상태에서 활성화 시도 시, 기존 기본 테마를 자동으로
   * 슬롯에서 내린다 (auto-evict). 이전에는 `BadRequestException`을 던져 사용자가
   * 기본 테마 전환을 위해 수동으로 슬롯을 비워야 했음 — free 플랜(슬롯 1)에서는 전환 경로가 막혀
   * 있던 UX 버그. 테마 설정 자체는 `is_slotted=false`로 전환만 되고 삭제되지 않으므로 안전.
   * 그래도 슬롯 빈 상태에서 activate한 테마 자체는 수용할 슬롯이 없으면 여전히 거부.
   */
  async activateTheme(authorId: string, themeId: string): Promise<Theme> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    if (isPlanExpired(author.plan, author.planExpireAt)) {
      throw new ForbiddenException('구독 플랜이 만료되었습니다. 플랜을 갱신하세요.')
    }

    const theme = await this.themeRepo.findById(themeId)
    if (!theme) throw new NotFoundException('테마를 찾을 수 없습니다')
    if (theme.authorId !== authorId) throw new ForbiddenException('본인의 테마만 활성화할 수 있습니다')
    if (theme.source === 'system') throw new ForbiddenException('시스템 테마는 활성화할 수 없습니다. 복사하여 사용하세요.')

    // 슬롯에 없으면 자동 슬롯 배정, 가득 차면 기존 기본 테마를 보관으로 내리고 공간 확보
    if (!theme.isSlotted) {
      const slotLimit = THEME_SLOT_LIMITS[author.plan] ?? 1
      const slottedCount = await this.themeRepo.countSlottedByAuthorId(authorId)
      if (slottedCount >= slotLimit) {
        // auto-evict: 현재 기본 테마를 슬롯에서 내려 공간을 만든다
        // 설정값 자체는 유지되므로 사용자가 나중에 다시 활성화 가능
        if (author.defaultThemeId && author.defaultThemeId !== themeId) {
          await this.themeRepo.updateSlotStatus(author.defaultThemeId, false)
        } else {
          // 방어적: 기본 테마가 없거나 자기 자신인데 슬롯이 찼다면 운영자 점검 필요
          throw new BadRequestException(
            `테마 슬롯이 가득 찼습니다 (${slottedCount}/${slotLimit}). 다른 테마를 슬롯에서 제거하세요.`,
          )
        }
      }
      await this.themeRepo.updateSlotStatus(themeId, true)
    }

    await this.authorRepo.updateDefaultThemeId(authorId, themeId)
    return theme
  }

  /** 슬롯 현황 조회 — 전체 테마 + 슬롯 상태 + 플랜 정보 + 기본 테마 */
  async getSlotInfo(authorId: string): Promise<{
    plan: string
    planExpireAt: Date | null
    isExpired: boolean
    slotLimit: number
    slottedCount: number
    defaultThemeId: string | null
    themes: Theme[]
  }> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    const themes = await this.themeRepo.findAllByAuthorId(authorId)
    const slottedCount = themes.filter(t => t.isSlotted).length
    const slotLimit = THEME_SLOT_LIMITS[author.plan] ?? 1

    return {
      plan: author.plan,
      planExpireAt: author.planExpireAt,
      isExpired: isPlanExpired(author.plan, author.planExpireAt),
      slotLimit,
      slottedCount,
      defaultThemeId: author.defaultThemeId ?? null,
      themes,
    }
  }
}
