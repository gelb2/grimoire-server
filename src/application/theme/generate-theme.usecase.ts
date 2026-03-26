import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditReason } from '@domain/model/credit'
import { Theme } from '@domain/model/theme'

@Injectable()
export class GenerateThemeUseCase {
  constructor(
    @Inject('ClaudeApiPort') private readonly claudeApi: ClaudeApiPort,
    @Inject('ThemeRepositoryPort') private readonly themeRepo: ThemeRepositoryPort,
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('CreditRepositoryPort') private readonly creditRepo: CreditRepositoryPort,
  ) {}

  async execute(authorId: string, description: string): Promise<Theme> {
    // 작가 존재 확인
    const author = await this.authorRepo.findById(authorId)
    if (!author) {
      throw new NotFoundException('작가를 찾을 수 없습니다')
    }

    // 크레딧 확인
    if (author.credits < 1) {
      throw new BadRequestException('크레딧이 부족합니다')
    }

    // 기존 테마 여부 확인 (재생성 vs 최초 생성)
    const existing = await this.themeRepo.findByAuthorId(authorId)
    const reason = existing ? CreditReason.THEME_REGENERATE : CreditReason.THEME_GENERATE

    // 크레딧 즉시 차감 (Tajook 패턴)
    await this.creditRepo.adjustCredits(authorId, -1, reason)

    // Claude API로 테마 생성 — 실패 시 크레딧 환불
    let themeData: any
    try {
      themeData = await this.claudeApi.generateTheme(description)
    } catch (error) {
      // AI 호출 실패 → 크레딧 환불
      await this.creditRepo.adjustCredits(authorId, 1, 'theme_generate_refund')
      throw error
    }

    // tone 기반으로 프리셋 결정
    const preset = themeData.tone === 'dark' ? 'midnight'
      : themeData.tone === 'sepia' ? 'parchment'
      : themeData.tone === 'light' ? 'morning'
      : 'custom'

    // DB에 저장 (upsert)
    return this.themeRepo.upsert(authorId, preset, themeData, description)
  }
}
