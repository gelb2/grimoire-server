import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditReason } from '@domain/model/credit'
import { Theme } from '@domain/model/theme'
import { THEME_SLOT_LIMITS } from '@domain/model/config'

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

    // 테마 슬롯 확인
    const plan = 'free' // 추후 author.plan으로 전환
    const slotLimit = THEME_SLOT_LIMITS[plan] ?? 1
    const currentCount = await this.themeRepo.countByAuthorId(authorId)
    if (currentCount >= slotLimit) {
      throw new BadRequestException(
        `테마 슬롯이 가득 찼습니다 (${currentCount}/${slotLimit}). 기존 테마를 삭제하세요.`,
      )
    }

    // 일일 무료 생성 횟수 확인 (추후 Redis 등으로 전환)
    // 현재는 항상 크레딧 차감 (일일 무료 횟수 추적은 Phase 2)
    const reason = CreditReason.THEME_GENERATE

    // 크레딧 확인 + 즉시 차감 (Tajook 패턴)
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

    // DB에 저장 (create — 슬롯 제한 이미 체크됨)
    const name = themeName ?? `테마 ${currentCount + 1}`
    return this.themeRepo.create(authorId, name, preset, themeData, description)
  }
}
