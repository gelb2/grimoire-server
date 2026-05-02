import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditReason } from '@domain/model/credit'
import { Theme } from '@domain/model/theme'
import { isPlanExpired } from '@domain/model/plan'
import { DAILY_FREE_LIMITS } from '@domain/model/config'
import { guardPromptInjection } from '@lib/prompt-injection-guard'

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
    // P17 — LLM Prompt Injection 방어 (OWASP LLM01, Constitution 19 Principles)
    // 테마 description은 짧은 자연어 → injection 패턴은 즉시 차단
    guardPromptInjection(description, 'theme.generate')

    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    if (isPlanExpired(author.plan, author.planExpireAt)) {
      throw new ForbiddenException('구독 플랜이 만료되었습니다. 플랜을 갱신하세요.')
    }

    // 일일 무료 생성 제한 체크 — 오늘 생성한 테마 수 vs 플랜별 한도
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayCount = await this.themeRepo.countByAuthorIdSince(authorId, ['ai', 'user'], todayStart)
    const dailyLimit = DAILY_FREE_LIMITS[author.plan] ?? DAILY_FREE_LIMITS.free
    const isFree = todayCount < dailyLimit

    // 무료 한도 초과 시 크레딧 차감
    if (!isFree) {
      try {
        await this.creditRepo.adjustCredits(authorId, -1, CreditReason.THEME_GENERATE)
      } catch {
        throw new BadRequestException(`오늘 무료 생성 한도(${dailyLimit}회)를 초과했습니다. 크레딧이 부족합니다.`)
      }
    }

    // Claude API로 테마 생성 — 실패 시 크레딧 환불 (유료 생성인 경우만)
    let themeData: any
    try {
      themeData = await this.claudeApi.generateTheme(description)
    } catch (error) {
      if (!isFree) {
        await this.creditRepo.adjustCredits(authorId, 1, 'theme_generate_refund')
      }
      throw error
    }

    // 보관 상태로 생성 (isSlotted=false). 활성화는 작가가 직접.
    // AI가 생성한 tagline 또는 headerSubtitle을 이름으로 활용
    const autoName = themeData.tagline || themeData.decorations?.headerSubtitle || null
    const themeCount = await this.themeRepo.countByAuthorId(authorId)
    const name = themeName ?? autoName ?? `테마 ${themeCount + 1}`
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
