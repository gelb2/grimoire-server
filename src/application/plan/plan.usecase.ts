import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { THEME_SLOT_LIMITS } from '@domain/model/config'
import { isPlanExpired } from '@domain/model/plan'

@Injectable()
export class PlanUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('ThemeRepositoryPort') private readonly themeRepo: ThemeRepositoryPort,
  ) {}

  /** 플랜 정보 조회 */
  async getPlanInfo(authorId: string): Promise<{
    plan: string
    planExpireAt: Date | null
    isExpired: boolean
    slotLimit: number
    slottedCount: number
    totalThemes: number
  }> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    const slottedCount = await this.themeRepo.countSlottedByAuthorId(authorId)
    const totalThemes = await this.themeRepo.countByAuthorId(authorId)

    return {
      plan: author.plan,
      planExpireAt: author.planExpireAt,
      isExpired: isPlanExpired(author.plan, author.planExpireAt),
      slotLimit: THEME_SLOT_LIMITS[author.plan] ?? 1,
      slottedCount,
      totalThemes,
    }
  }

  /** 플랜 활성화 (관리자용 — 가격 미정이므로 수동 설정) */
  async activatePlan(authorId: string, plan: string, durationDays: number): Promise<void> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    const validPlans = Object.keys(THEME_SLOT_LIMITS)
    if (!validPlans.includes(plan)) {
      throw new BadRequestException(`유효하지 않은 플랜입니다. 사용 가능: ${validPlans.join(', ')}`)
    }

    if (durationDays <= 0) {
      throw new BadRequestException('기간은 1일 이상이어야 합니다')
    }

    const planExpireAt = plan === 'free'
      ? null  // free 플랜은 만기 없음
      : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)

    await this.authorRepo.updatePlan(authorId, plan, planExpireAt)
    // 슬롯은 자동 복원하지 않음 — 작가가 직접 테마를 슬롯에 배치
  }

  /** 만기 처리 — 모든 테마를 슬롯에서 해제 (지연 실행) */
  async handleExpiry(authorId: string): Promise<void> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) return

    if (isPlanExpired(author.plan, author.planExpireAt)) {
      await this.themeRepo.unslotAllByAuthorId(authorId)
    }
  }
}
