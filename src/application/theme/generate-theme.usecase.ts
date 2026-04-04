import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditReason } from '@domain/model/credit'
import { Theme } from '@domain/model/theme'
import { THEME_SLOT_LIMITS } from '@domain/model/config'
import { isPlanExpired } from '@domain/model/plan'

@Injectable()
export class GenerateThemeUseCase {
  constructor(
    @Inject('ClaudeApiPort') private readonly claudeApi: ClaudeApiPort,
    @Inject('ThemeRepositoryPort') private readonly themeRepo: ThemeRepositoryPort,
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('CreditRepositoryPort') private readonly creditRepo: CreditRepositoryPort,
  ) {}

  async execute(authorId: string, description: string, themeName?: string): Promise<Theme> {
    // 작가 존재 확인
    const author = await this.authorRepo.findById(authorId)
    if (!author) {
      throw new NotFoundException('작가를 찾을 수 없습니다')
    }

    // 플랜 만기 체크
    if (isPlanExpired(author.plan, author.planExpireAt)) {
      throw new ForbiddenException('구독 플랜이 만료되었습니다. 플랜을 갱신하세요.')
    }

    // 슬롯 여유 체크 (슬롯에 배치된 테마 수 기준)
    const plan = author.plan
    const slotLimit = THEME_SLOT_LIMITS[plan] ?? 1
    const slottedCount = await this.themeRepo.countSlottedByAuthorId(authorId)
    if (slottedCount >= slotLimit) {
      throw new BadRequestException(
        `테마 슬롯이 가득 찼습니다 (${slottedCount}/${slotLimit}). 기존 테마를 슬롯에서 제거하세요.`,
      )
    }

    // 크레딧 확인 + 즉시 차감
    const reason = CreditReason.THEME_GENERATE
    if (author.credits < 1) {
      throw new BadRequestException('크레딧이 부족합니다')
    }
    await this.creditRepo.adjustCredits(authorId, -1, reason)

    // Claude API로 테마 생성 — 실패 시 크레딧 환불
    let themeData: any
    try {
      themeData = await this.claudeApi.generateTheme(description)
    } catch (error) {
      await this.creditRepo.adjustCredits(authorId, 1, 'theme_generate_refund')
      throw error
    }

    // tone 기반으로 프리셋 결정
    const preset = themeData.tone === 'dark' ? 'midnight'
      : themeData.tone === 'sepia' ? 'parchment'
      : themeData.tone === 'light' ? 'morning'
      : 'custom'

    // DB에 저장 (isSlotted=true 기본값 → 자동으로 슬롯에 배치)
    const name = themeName ?? `테마 ${slottedCount + 1}`
    return this.themeRepo.create(authorId, name, preset, themeData, description)
  }
}
