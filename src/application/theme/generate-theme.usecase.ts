import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { CreditRepositoryPort } from '@domain/port/outbound/credit-repository.port'
import { CreditReason } from '@domain/model/credit'
import { Theme } from '@domain/model/theme'
import { THEME_SLOT_LIMITS } from '@domain/model/config'
import { isPlanExpired } from '@domain/model/plan'
import { themePresets } from '@domain/model/theme-presets'

/** 시스템 프리셋으로 제공할 프리셋 목록 (deerDevil, system-default 제외) */
const SYSTEM_PRESET_NAMES = Object.keys(themePresets).filter(
  (k) => k !== 'deerDevil' && k !== 'system-default',
)

/** 프리셋 한글 라벨 매핑 */
const PRESET_LABELS: Record<string, { label: string; genre: string }> = {
  midnight: { label: '미드나잇', genre: '호러, 다크 판타지' },
  parchment: { label: '파치먼트', genre: '역사, 고전' },
  morning: { label: '모닝', genre: '로맨스, 일상' },
  neon: { label: '네온', genre: 'SF, 사이버펑크' },
  cream: { label: '크림', genre: '에세이, 시' },
  magazine: { label: '매거진', genre: '매거진, 에디토리얼' },
  gallery: { label: '갤러리', genre: '갤러리, 포트폴리오' },
  minimal: { label: '미니멀', genre: '극단적 미니멀' },
}

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
    return this.themeRepo.create(authorId, name, preset, themeData, description, 'ai')
  }

  /** 시스템 프리셋 목록 반환 */
  listPresets() {
    return SYSTEM_PRESET_NAMES.map((name) => {
      const preset = themePresets[name] as Record<string, unknown>
      const info = PRESET_LABELS[name] ?? { label: name, genre: '' }
      return {
        name,
        label: info.label,
        tone: preset.tone as string,
        genre: info.genre,
        preview: {
          bgPrimary: preset.bgPrimary,
          bgSecondary: preset.bgSecondary,
          accent: preset.accent,
          textPrimary: preset.textPrimary,
          textBright: preset.textBright,
        },
      }
    })
  }

  /** 시스템 프리셋을 선택하여 테마 생성 (크레딧 소모 없음) */
  async createFromPreset(authorId: string, presetName: string, themeName?: string): Promise<Theme> {
    // 프리셋 유효성 검사
    if (!SYSTEM_PRESET_NAMES.includes(presetName)) {
      throw new BadRequestException(`유효하지 않은 프리셋입니다: ${presetName}`)
    }

    // 작가 존재 확인
    const author = await this.authorRepo.findById(authorId)
    if (!author) {
      throw new NotFoundException('작가를 찾을 수 없습니다')
    }

    // 플랜 만기 체크
    if (isPlanExpired(author.plan, author.planExpireAt)) {
      throw new ForbiddenException('구독 플랜이 만료되었습니다. 플랜을 갱신하세요.')
    }

    // 슬롯 여유 체크
    const slotLimit = THEME_SLOT_LIMITS[author.plan] ?? 1
    const slottedCount = await this.themeRepo.countSlottedByAuthorId(authorId)
    if (slottedCount >= slotLimit) {
      throw new BadRequestException(
        `테마 슬롯이 가득 찼습니다 (${slottedCount}/${slotLimit}). 기존 테마를 슬롯에서 제거하세요.`,
      )
    }

    const name = themeName ?? PRESET_LABELS[presetName]?.label ?? presetName
    // overrides는 빈 객체 — preset 기본값을 그대로 사용
    return this.themeRepo.create(authorId, name, presetName, {} as any, `프리셋: ${presetName}`, 'system')
  }
}
