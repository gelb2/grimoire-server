import { Injectable } from '@nestjs/common'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { AuthorTheme } from '@domain/model/theme'
import { askClaude } from '@lib/claude'
import { parseClaudeJSON } from '@lib/json-parser'

const THEME_SYSTEM_PROMPT = `당신은 웹 테마 디자인 전문가입니다.
작가가 설명하는 분위기를 읽고, 소설 읽기 공간에 적합한 테마 JSON을 생성하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.

{
  "bgPrimary": "#hex",       // 배경색
  "bgSecondary": "#hex",     // 카드/섹션 배경
  "textPrimary": "#hex",     // 본문 텍스트
  "textMuted": "#hex",       // 보조 텍스트
  "textBright": "#hex",      // 강조 텍스트 (제목, 하이라이트)
  "textDim": "#hex",         // 매우 흐린 텍스트 (장식/플레이스홀더용)
  "accent": "#hex",          // 강조색 (링크, 버튼)
  "accent2": "#hex",         // 보조 강조색 (accent의 밝은/연한 변형)
  "border": "#hex",          // 경계선

  "fontBody": "serif" | "sans-serif" | "monospace",
  "fontHeading": "serif" | "sans-serif" | "monospace",

  "animation": "typing" | "fade" | "slide" | "none",
  "tone": "dark" | "light" | "sepia",

  "titleSize": "sm" | "md" | "lg" | "xl",
  "titleWeight": "light" | "normal" | "bold" | "black",
  "letterSpacing": "tight" | "normal" | "wide",
  "bodyLineHeight": "compact" | "normal" | "relaxed",
  "contentWidth": "narrow" | "normal" | "wide",

  "layout": "series" | "grid" | "classic" | "magazine" | "gallery" | "minimal",
  "heroStyle": "fullname" | "cover" | "minimal" | "none",
  "navStyle": "sidebar" | "top" | "hidden"
}

색상 규칙:
- 모든 색상은 #으로 시작하는 6자리 hex 코드
- bgPrimary와 textPrimary는 충분한 명도 대비 확보 (WCAG AA 이상)
- tone이 "dark"이면 bgPrimary는 어두운 색, tone이 "light"이면 밝은 색

분위기 해석:
- 작가의 감성을 존중하되, 실제 웹 가독성을 최우선으로
- 소설 읽기에 적합한 편안한 색상과 폰트 선택
- 애니메이션은 분위기에 맞게 선택 (고요한 분위기 → fade/none, 역동적 → typing/slide)

타이포그래피 해석:
- 무겁고 강렬한 분위기 → titleSize: "xl", titleWeight: "black"
- 가볍고 우아한 분위기 → titleSize: "lg", titleWeight: "light", letterSpacing: "wide"
- 밀도 높은 텍스트 → bodyLineHeight: "compact", contentWidth: "wide"
- 여유로운 독서 → bodyLineHeight: "relaxed", contentWidth: "narrow"

레이아웃 해석:
- 시리즈 소설 → layout: "series", heroStyle: "minimal"
- 에디토리얼/잡지 → layout: "magazine", heroStyle: "fullname", navStyle: "sidebar"
- 포트폴리오/갤러리 → layout: "gallery", heroStyle: "fullname", navStyle: "hidden"
- 미니멀 → layout: "minimal", heroStyle: "cover", navStyle: "hidden"`

@Injectable()
export class ClaudeThemeAdapter implements ClaudeApiPort {
  async generateTheme(description: string): Promise<AuthorTheme> {
    const response = await askClaude(THEME_SYSTEM_PROMPT, description, {
      maxTokens: 1024,
    })
    return parseClaudeJSON<AuthorTheme>(response)
  }

  async ask(systemPrompt: string, userMessage: string, options?: { maxTokens?: number }): Promise<string> {
    return askClaude(systemPrompt, userMessage, options)
  }
}
