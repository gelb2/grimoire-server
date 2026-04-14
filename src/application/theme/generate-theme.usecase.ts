import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditReason } from '@domain/model/credit'
import { Theme } from '@domain/model/theme'
import { isPlanExpired } from '@domain/model/plan'

@Injectable()
export class GenerateThemeUseCase {
  constructor(
    @Inject('ClaudeApiPort') private readonly claudeApi: ClaudeApiPort,
    @Inject('ThemeRepositoryPort') private readonly themeRepo: ThemeRepositoryPort,
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('CreditRepositoryPort') private readonly creditRepo: CreditRepositoryPort,
  ) {}

  /** AI 테마 생성 — 슬롯 체크 없음 (생성은 자유, 활성화가 슬롯 제한) */
  async execute(authorId: string, description: string, themeName?: string): Promise<Theme> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    if (isPlanExpired(author.plan, author.planExpireAt)) {
      throw new ForbiddenException('구독 플랜이 만료되었습니다. 플랜을 갱신하세요.')
    }

    // 크레딧 차감 — adjustCredits 내부 $transaction에서 원자적으로 체크+차감
    // 메모리 값으로 선 체크하지 않음 (Race Condition 방지)
    try {
      await this.creditRepo.adjustCredits(authorId, -1, CreditReason.THEME_GENERATE)
    } catch {
      throw new BadRequestException('크레딧이 부족합니다')
    }

    // Claude API로 테마 생성 — 실패 시 크레딧 환불
    let themeData: any
    try {
      themeData = await this.claudeApi.generateTheme(description)
    } catch (error) {
      await this.creditRepo.adjustCredits(authorId, 1, 'theme_generate_refund')
      throw error
    }

    // 보관 상태로 생성 (isSlotted=false). 활성화는 작가가 직접.
    const themeCount = await this.themeRepo.countByAuthorId(authorId)
    const name = themeName ?? `테마 ${themeCount + 1}`
    return this.themeRepo.create(authorId, name, 'custom', themeData, description, 'ai')
  }

  /** 시스템 프리셋 목록 — DB에서 조회 */
  async listPresets(): Promise<{ name: string; label: string; tone: string; genre: string; preview: Record<string, unknown>; overrides: Record<string, unknown> }[]> {
    const themes = await this.themeRepo.findSystemThemes()
    return themes.map((t) => {
      const ov = (t.overrides ?? {}) as Record<string, unknown>
      return {
        name: t.preset,
        label: t.name,
        tone: (ov.tone as string) ?? '',
        genre: t.rawDescription ?? '',
        preview: {
          bgPrimary: ov.bgPrimary,
          bgSecondary: ov.bgSecondary,
          accent: ov.accent,
          textPrimary: ov.textPrimary,
          textBright: ov.textBright,
        },
        overrides: ov,
      }
    })
  }

  /** 시스템 테마를 복사하여 작가 테마 생성 (크레딧 소모 없음, 중복 방지) */
  async createFromPreset(authorId: string, presetName: string, themeName?: string): Promise<Theme> {
    // DB에서 시스템 테마 조회
    const systemTheme = await this.themeRepo.findSystemThemeByPreset(presetName)
    if (!systemTheme) throw new BadRequestException(`유효하지 않은 프리셋입니다: ${presetName}`)

    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    if (isPlanExpired(author.plan, author.planExpireAt)) {
      throw new ForbiddenException('구독 플랜이 만료되었습니다. 플랜을 갱신하세요.')
    }

    // 중복 방지: 같은 프리셋명 + source='user'인 미수정 테마가 있으면 기존 것 반환
    // (JSON.stringify 순서 의존 제거 — preset명 기반 비교)
    const existing = await this.themeRepo.findAllByAuthorId(authorId)
    const duplicate = existing.find((t) => t.preset === presetName && t.source === 'user')
    if (duplicate) return duplicate

    const name = themeName ?? systemTheme.name
    return this.themeRepo.create(authorId, name, presetName, systemTheme.overrides as any, `프리셋 복사: ${presetName}`, 'user')
  }
}
