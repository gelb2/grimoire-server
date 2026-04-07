# Technical Review: AI 기반 동적 테마 시스템 + 시맨틱 캐싱 아키텍처

> 검토일: 2026-03-29
> 요청: 제미나이 제안 아키텍처에 대한 기술적 검토
> 검토자: Claude (시스템 아키텍트 관점)

---

## 1. 제안 요약

작가가 프롬프트로 테마를 요청하면:
1. **Phase 1 (Vector Search)**: 기존 DB에서 의미적으로 유사한 테마를 즉시 반환
2. **Phase 2 (LLM Fallback)**: 유사한 테마가 없으면 Claude API로 새로 생성
3. **Phase 3 (DB Update)**: 새 테마를 벡터 DB에 저장하여 다음 검색 자산으로 활용

---

## 2. 현재 Grimoire 구현 상태와의 비교

### 이미 구현된 것

| 제안 항목 | 현재 구현 | 상태 |
|----------|----------|------|
| LLM API로 테마 생성 | `GenerateThemeUseCase` → Claude API | ✅ 완료 |
| 테마 JSON 스키마 | `AuthorTheme` 인터페이스 (15+ 필드) | ✅ 완료 |
| CSS 변수 매핑 | `ThemeProvider` → `--g-*` CSS Variables | ✅ 완료 |
| CSS 인젝션 방어 | `bakeThemeToCSS()` → sanitizeCSS | ✅ 완료 |
| 크레딧 차감 | 1크레딧/생성, 실패 시 환불 | ✅ 완료 |
| 임베딩 인프라 | `OpenAIEmbeddingAdapter` + `PgVectorAdapter` | ✅ 완료 (RAG용) |
| 벡터 DB | pgvector 확장 (PostgreSQL 내장) | ✅ 완료 (RAG용) |

### 구현되지 않은 것

| 제안 항목 | 현재 상태 |
|----------|----------|
| 테마 프롬프트 임베딩 | ❌ 없음 (프롬프트를 벡터화하지 않음) |
| 시맨틱 테마 검색 | ❌ 없음 (프리셋 5개 하드코딩) |
| 테마 벡터 DB 저장 | ❌ 없음 (RAG용 벡터만 존재) |
| 유사도 기반 폴백 | ❌ 없음 (항상 LLM 호출) |

---

## 3. 기술적 검토 (비판적 분석)

### 3-1. 프론트엔드 렌더링 안정성

**현재 방어 체계:**

Grimoire는 AI가 생성한 CSS를 **직접 렌더링하지 않습니다.** 대신:

1. Claude API가 **JSON** (AuthorTheme)을 반환
2. `parseClaudeJSON()`이 JSON 파싱 + 에러 복구
3. `ThemeProvider`가 JSON 값을 **인라인 CSS 변수**로 주입 (`--g-bg: #07070a`)
4. Tailwind 클래스가 CSS 변수를 참조 (`bg-g-bg`)

**이 구조의 장점:**
- AI가 `<script>alert(1)</script>` 같은 값을 생성해도, CSS 변수에 들어가므로 XSS 불가
- `bakeThemeToCSS()`에서 `url()`, `expression()`, `javascript:` 패턴 차단
- AI가 잘못된 hex 코드를 생성해도 최악의 경우 "색이 안 보임"이지 레이아웃 붕괴가 아님

**위험이 되는 시나리오:**
- AI가 `fontBody: "cursive"` 같은 예상 외 값 반환 → 현재 `"serif" | "sans-serif" | "monospace"` 타입으로 제한됨 ✅
- AI가 `bgPrimary`에 `transparent` 반환 → 배경이 사라짐. **검증 필요** ⚠️

**권장 추가 방어:**
```typescript
function validateThemeColors(theme: AuthorTheme): AuthorTheme {
  const hexPattern = /^#[0-9a-fA-F]{6}$/
  for (const key of ['bgPrimary', 'bgSecondary', 'textPrimary', ...]) {
    if (!hexPattern.test(theme[key])) {
      theme[key] = DEFAULT_THEME[key] // 폴백
    }
  }
  return theme
}
```

**결론:** 현재 구조가 이미 안전합니다. AI가 CSS 자체를 생성하지 않고 JSON 값만 생성하므로, 제미나이가 우려하는 "CSS 파서/새니타이저" 필요성은 **이 프로젝트에서는 낮습니다.**

---

### 3-2. 합성(Synthesis) vs 검색(Search)

**제미나이 제안:** "여러 테마를 섞지 말고, 완성된 단일 테마를 검색해서 반환하라."

**동의합니다. 이유:**

테마 합성의 위험:
```
테마 A: bgPrimary=#07070a (다크), accent=#9a8060 (골드)
테마 B: bgPrimary=#faf8f5 (라이트), accent=#2563eb (블루)

합성 결과: bgPrimary=#07070a + accent=#2563eb
→ 다크 배경에 블루 강조 — 원래 의도와 전혀 다른 분위기
→ 더 나쁜 경우: 대비(contrast)가 부족해서 텍스트가 안 읽힘
```

**시맨틱 검색 타당성:**

Grimoire에 이미 `OpenAIEmbeddingAdapter` + `pgvector`가 있습니다. RAG(소설 분석)용으로 쓰고 있지만, 테마 검색에도 동일한 인프라를 재사용할 수 있습니다.

**추천 구현:**

```
테마 생성 시:
1. 작가 프롬프트 ("어둡고 묵직한 A24 감성") → 임베딩
2. 기존 테마 프롬프트 벡터와 코사인 유사도 검색
3. 유사도 > 0.85 → 기존 테마 반환 (크레딧 0 또는 할인)
4. 유사도 < 0.85 → Claude API 호출 (크레딧 1)
5. 새 테마 + 프롬프트 임베딩 → DB 저장
```

**기술 스택 (이미 Grimoire에 있음):**
- 임베딩: `OpenAIEmbeddingAdapter` (text-embedding-3-small)
- 벡터 DB: `PgVectorAdapter` (PostgreSQL pgvector)
- 유사도 검색: `vectorStore.searchSimilar()`

**추가로 필요한 것:**
- `theme_embeddings` 테이블 (theme_id, prompt_embedding, raw_prompt)
- `ThemeCacheUseCase` (검색 → 폴백 → 저장 파이프라인)

---

### 3-3. 데이터 규격화 (TypeScript 타입 안전성)

**현재 상태: 이미 엄격하게 통제됨**

```typescript
export interface AuthorTheme {
  bgPrimary: string          // #hex 6자리
  bgSecondary: string
  textPrimary: string
  textMuted: string
  textDim: string
  textBright: string
  accent: string
  accent2: string
  border: string
  fontBody: "serif" | "sans-serif" | "monospace"
  fontHeading: "serif" | "sans-serif" | "monospace"
  animation: "typing" | "fade" | "slide" | "none"
  tone: "dark" | "light" | "sepia"
  layout: "series" | "grid" | "classic"
  decorations: ThemeDecorations
  tagline?: string
  typingSpeed?: number
  cardRadius?: string
  navOpacity?: number
}
```

**제미나이 우려 "any를 허용하지 않고":**

현재 `any`는 **api.ts 호출처에서만** 사용되고, 테마 데이터 자체는 `AuthorTheme` 인터페이스로 완전히 타입화되어 있습니다. Claude API 응답은 `parseClaudeJSON<AuthorTheme>()`로 파싱되어 타입이 강제됩니다.

**추가 권장 — 런타임 검증:**

TypeScript 타입은 컴파일 타임에만 동작합니다. AI 응답은 런타임 데이터이므로, Zod나 class-validator로 런타임 검증을 추가하면 더 안전합니다:

```typescript
import { z } from 'zod'

const ThemeSchema = z.object({
  bgPrimary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fontBody: z.enum(['serif', 'sans-serif', 'monospace']),
  animation: z.enum(['typing', 'fade', 'slide', 'none']),
  // ...
})

// Claude 응답 검증
const validated = ThemeSchema.safeParse(claudeResponse)
if (!validated.success) {
  // 폴백 테마 사용
}
```

---

## 4. 종합 평가

| 항목 | 제미나이 제안 | 현재 Grimoire | 검토 결과 |
|------|-------------|-------------|----------|
| 시맨틱 캐싱 | ✅ 필요 | ❌ 미구현 | **도입 가치 있음** — 인프라 이미 있음 |
| CSS 파서/새니타이저 | ✅ 제안 | ✅ 이미 안전 | **불필요** — JSON 기반이라 CSS 직접 렌더 없음 |
| 합성 vs 검색 | 검색 권장 | 해당 없음 | **동의** — 합성은 UI 붕괴 위험 |
| 타입 안전성 | any 금지 | ✅ 인터페이스 완성 | **추가로 런타임 검증(Zod) 권장** |

### 도입 우선순위

1. **즉시 가능:** 테마 프롬프트 임베딩 + 유사도 검색 (기존 RAG 인프라 재사용)
2. **중기:** Zod 런타임 검증 추가
3. **장기:** 테마 생성 통계 분석 → 캐시 히트율 최적화

### 비용 절감 효과 추정

현재: 테마 생성 1회 ≈ 2000 tokens ≈ 약 12원 + 임베딩 ≈ 1원 = **13원/회**

시맨틱 캐싱 도입 시:
- 캐시 히트 (유사 테마 존재): 임베딩만 = **1원/회** (92% 절감)
- 캐시 미스 (새 생성): 기존과 동일 = **13원/회**
- 캐시 히트율 50% 가정 시: 평균 **7원/회** (46% 절감)

---

## 5. 참조

- 현재 테마 시스템: `grimoire-server/src/application/theme/generate-theme.usecase.ts`
- 임베딩 어댑터: `grimoire-server/src/adapter/outbound/embedding/openai-embedding.adapter.ts`
- 벡터 DB: `grimoire-server/src/adapter/outbound/vector/pgvector.adapter.ts`
- CSS 베이킹: `grimoire-server/src/lib/theme-baker.ts`
- 테마 인터페이스: `grimoire-web/src/features/theme/presets.ts`
