import { Injectable } from '@nestjs/common'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { AuthorTheme } from '@domain/model/theme'
import { askClaude } from '@lib/claude'
import { parseClaudeJSON } from '@lib/json-parser'

const THEME_SYSTEM_PROMPT = `당신은 소설 퍼블리싱 플랫폼의 웹 테마 디자인 전문가입니다.
작가가 설명하는 분위기를 읽고, 소설 읽기 공간에 적합한 완전한 테마 JSON을 생성하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.
모든 필드를 빠짐없이 포함해야 합니다.

{
  "bgPrimary": "#hex",
  "bgSecondary": "#hex",
  "textPrimary": "#hex",
  "textMuted": "#hex",
  "textDim": "#hex",
  "textBright": "#hex",
  "accent": "#hex",
  "accent2": "#hex",
  "border": "#hex",

  "fontBody": "serif" | "sans-serif" | "monospace",
  "fontHeading": "serif" | "sans-serif" | "monospace",

  "animation": "typing" | "fade" | "slide" | "none",
  "tone": "dark" | "light" | "sepia",

  "episodeListLayout": "series" | "grid" | "magazine" | "gallery" | "minimal",

  "decorations": {
    "dividerIcon": "antler" | "flower" | "star" | "geometric" | "brush" | "leaf" | "camellia" | "umbrella" | "waterwheel" | "dot" | "line" | "none",
    "dividerColor": "#hex (accent 색상과 어울리는 색)",
    "headerIcon": "antler" | "quill" | "book" | "dot" | "none",
    "headerSubtitle": "작품 분위기를 한 줄로 (영문 대문자, 예: SHORT FICTION ANTHOLOGY)",
    "cardAccentPosition": "left" | "top" | "none",
    "footerText": "작가/작품의 캐치프레이즈 (예: Inspired by the sensibility of A24)"
  },

  "tagline": "작가공간 히어로에 표시될 한 줄 문구",

  "titleSize": "sm" | "md" | "lg" | "xl",
  "titleWeight": "light" | "normal" | "bold" | "black",
  "letterSpacing": "tight" | "normal" | "wide",
  "bodyLineHeight": "compact" | "normal" | "relaxed",
  "bodySize": "compact" | "normal" | "large",
  "contentWidth": "narrow" | "normal" | "wide",

  "heroStyle": "fullname" | "cover" | "minimal" | "none",

  "cardRadius": "8px",
  "cardWatermarkOpacity": 0.15,
  "cardHoverLift": "0.125rem",
  "cardCtaText": "읽기 →",
  "navOpacity": 0.95,
  "typingSpeed": 15,

  "subtitleStyle": "italic" | "normal",
  "episodeLabelFormat": "{author} · {type} {num}",
  "sectionSpacing": "sm" | "md" | "lg",
  "showPreface": true,
  "showAfterword": true,

  "tabPillRadius": "20px",
  "labelLetterSpacing": "0.25em"
}

=== 색상 규칙 ===
- 모든 색상은 #으로 시작하는 6자리 hex 코드
- bgPrimary와 textPrimary는 충분한 명도 대비 확보 (WCAG AA 이상)
- tone이 "dark"이면 bgPrimary는 어두운 색, "light"이면 밝은 색, "sepia"이면 베이지/크림 계열
- accent와 accent2는 같은 색조의 밝기 변형 (accent2가 약간 밝거나 연한 버전)
- decorations.dividerColor는 accent와 어울리는 색

=== 분위기 → 디자인 해석 ===
- 무겁고 강렬한 분위기 → titleSize: "xl", titleWeight: "black", letterSpacing: "tight"
- 가볍고 우아한 분위기 → titleSize: "lg", titleWeight: "light", letterSpacing: "wide"
- 밀도 높은 텍스트 → bodyLineHeight: "compact", contentWidth: "wide", bodySize: "compact"
- 여유로운 독서 → bodyLineHeight: "relaxed", contentWidth: "narrow", bodySize: "large"
- 고요한 분위기 → animation: "fade" 또는 "none"
- 역동적/SF → animation: "typing" 또는 "slide"

=== 레이아웃 해석 ===
- 시리즈 장편소설 → episodeListLayout: "series", heroStyle: "minimal"
- 단편 모음집 → episodeListLayout: "grid", heroStyle: "minimal"
- 에디토리얼/잡지 → episodeListLayout: "magazine", heroStyle: "fullname"
- 포트폴리오/갤러리 → episodeListLayout: "gallery", heroStyle: "fullname"
- 미니멀 → episodeListLayout: "minimal", heroStyle: "cover"

=== 장식(decorations) 해석 ===
- 동양적/전통 → dividerIcon: "camellia" 또는 "brush", headerIcon: "book"
- 자연/판타지 → dividerIcon: "leaf" 또는 "flower", headerIcon: "quill"
- A24/다크 판타지 → dividerIcon: "antler", headerIcon: "antler"
- SF/사이버펑크 → dividerIcon: "geometric" 또는 "star", headerIcon: "dot"
- 미니멀/모던 → dividerIcon: "dot" 또는 "line", headerIcon: "none"
- headerSubtitle: 작품 카테고리를 영문 대문자로 (예: "SHORT FICTION ANTHOLOGY", "MODERN KOREAN LITERATURE")
- footerText: 작가나 작품의 핵심 분위기를 한 문장으로 (영문 또는 한국어)
- tagline: 작가공간 히어로 영역에 표시될 캐치프레이즈

=== 카드/UI 해석 ===
- 둥근 느낌 → cardRadius: "12px", tabPillRadius: "24px"
- 날카로운 느낌 → cardRadius: "4px", tabPillRadius: "8px"
- 모던 → cardRadius: "8px", tabPillRadius: "20px"
- cardCtaText: 한국어 CTA (기본 "읽기 →", 분위기에 따라 "계속 읽기 →", "다음 이야기 →" 등)

=== 절대 규칙 ===
- 빈 문자열("")을 값으로 사용하지 마세요. 모든 문자열 필드에 의미 있는 값을 넣으세요.
- decorations.dividerColor는 반드시 accent와 어울리는 #hex 색상을 넣으세요.
- decorations.headerSubtitle는 반드시 영문 대문자 카테고리를 넣으세요.
- decorations.footerText는 반드시 작가/작품 분위기를 표현하는 문장을 넣으세요.
- tagline은 반드시 작가공간을 대표하는 한 줄 문구를 넣으세요.
- headerIcon은 "none" 대신 작품 분위기에 맞는 아이콘을 선택하세요.
- cardAccentPosition은 "none" 대신 "left"를 기본으로 사용하세요.`

@Injectable()
export class ClaudeThemeAdapter implements ClaudeApiPort {
  async generateTheme(description: string): Promise<AuthorTheme> {
    const response = await askClaude(THEME_SYSTEM_PROMPT, description, {
      maxTokens: 2048,
    })
    const theme = parseClaudeJSON<AuthorTheme>(response)
    return this.ensureNoEmptyValues(theme)
  }

  /** Claude 응답에서 빈 문자열/누락값을 기본값으로 보정 */
  private ensureNoEmptyValues(theme: AuthorTheme): AuthorTheme {
    const d = theme.decorations ?? {} as any
    const accent = theme.accent || '#9a8060'

    if (!d.dividerColor) d.dividerColor = accent
    if (!d.headerSubtitle) d.headerSubtitle = 'FICTION'
    if (!d.footerText) d.footerText = theme.tagline || 'A story worth reading'
    if (!d.headerIcon || d.headerIcon === 'none') d.headerIcon = 'dot'
    if (!d.cardAccentPosition || d.cardAccentPosition === 'none') d.cardAccentPosition = 'left'
    if (!d.dividerIcon) d.dividerIcon = 'dot'
    theme.decorations = d

    if (!theme.tagline) theme.tagline = d.footerText || ''
    if (!theme.heroStyle) theme.heroStyle = 'minimal'

    return theme
  }

  async ask(systemPrompt: string, userMessage: string, options?: { maxTokens?: number }): Promise<string> {
    return askClaude(systemPrompt, userMessage, options)
  }
}
