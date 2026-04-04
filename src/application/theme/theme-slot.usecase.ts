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

  /** 테마를 활성 슬롯에 배치 */
  async assignSlot(authorId: string, themeId: string): Promise<Theme> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    if (isPlanExpired(author.plan, author.planExpireAt)) {
      throw new ForbiddenException('구독 플랜이 만료되었습니다. 플랜을 갱신하세요.')
    }

    const theme = await this.themeRepo.findById(themeId)
    if (!theme) throw new NotFoundException('테마를 찾을 수 없습니다')
    if (theme.authorId !== authorId) throw new ForbiddenException('본인의 테마만 슬롯에 배치할 수 있습니다')

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

    return this.themeRepo.updateSlotStatus(themeId, true)
  }

  /** 테마를 슬롯에서 제거 (보관 상태로) */
  async removeFromSlot(authorId: string, themeId: string): Promise<Theme> {
    const theme = await this.themeRepo.findById(themeId)
    if (!theme) throw new NotFoundException('테마를 찾을 수 없습니다')
    if (theme.authorId !== authorId) throw new ForbiddenException('본인의 테마만 제거할 수 있습니다')

    if (!theme.isSlotted) {
      throw new BadRequestException('슬롯에 배치되지 않은 테마입니다')
    }

    return this.themeRepo.updateSlotStatus(themeId, false)
  }

  /** 슬롯 현황 조회 — 전체 테마 + 슬롯 상태 + 플랜 정보 */
  async getSlotInfo(authorId: string): Promise<{
    plan: string
    planExpireAt: Date | null
    isExpired: boolean
    slotLimit: number
    slottedCount: number
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
      themes,
    }
  }
}
