# Phase 1 작업지시서 — grimoire-server

> 이 문서는 grimoire-server 채팅방에서 작업을 시작할 때 참고하는 지시서입니다.
> 루트 CLAUDE.md, 기획서, 공유 문서를 모두 읽은 뒤 작업을 시작하세요.

---

## 0. 컨텍스트

### 프로젝트 정체

ProjectGrimoire (가칭) — 작가별 맞춤 시각 공간을 제공하는 소설 퍼블리싱 플랫폼.

### 현재 상태 (Phase 0 완료)

- **grimoire-web**: DeerDevil 코드 이식 완료. 멀티테넌트 라우팅 (`/[author]/`), 테마 프리셋 5종, ThemeProvider (CSS Variables 동적 주입). 유닛 70개 + E2E 22개 = 92개 통과. GitHub develop 푸시 완료.
- **grimoire-server**: CLAUDE.md + 공유 문서만 있는 빈 상태. **이 채팅방에서 NestJS 코드를 처음부터 작성해야 함.**

### 필수 읽기 문서 (이 순서대로)

1. `/Users/sokol/Desktop/Git/ProjectGrimoire/CLAUDE.md` — 루트 헌법 (공통 규칙, 문서 동기화, 브랜치 전략)
2. `/Users/sokol/Desktop/Git/ProjectGrimoire/PLANNING_GRIMOIRE.md` — 전체 기획서 (테마 시스템, 크레딧, 마일스톤, AI API 설계)
3. `/Users/sokol/Desktop/Git/ProjectGrimoire/grimoire-server/CLAUDE.md` — 서버 전용 규칙 (Hexagonal, Claude API, 엔드포인트)
4. `/Users/sokol/Desktop/Git/ProjectGrimoire/grimoire-server/docs/` — 공유 문서 6개

---

## 1. Phase 1 목표

grimoire-server를 NestJS로 구축하여 아래 기능을 제공한다:

| 기능 | 설명 |
|------|------|
| 테마 생성 API | 작가가 텍스트로 분위기 구술 → Claude API → 테마 JSON 반환 |
| 테마 조회 API | 작가 slug로 테마 조회 (grimoire-web이 호출) |
| 크레딧 시스템 | 가입 보너스, 테마 생성 시 차감, 감사 로그 |
| MD 파서 이관 | DeerDevil의 parse-md.ts를 서버사이드로 이관 |
| 원고 저장 API | MD 업로드 → 파싱 → Block[] DB 저장 |

---

## 2. 기술 스택

| 항목 | 기술 | 근거 |
|------|------|------|
| 프레임워크 | NestJS 10.x | projectZenith에서 검증 |
| 언어 | TypeScript (strict) | 공통 규칙 |
| ORM | Prisma 7.x | projectZenith에서 검증 |
| DB | PostgreSQL | Azure Database (Phase 1에서 생성) |
| AI | Anthropic Claude API (SDK 0.78+) | 테마 생성 |
| 컨테이너 | Docker | Azure Container Apps 배포 |
| 테스트 | Jest | 유닛 + 통합 |

---

## 3. 아키텍처 — Hexagonal

```
src/
├── domain/                     # 순수 비즈니스 로직
│   ├── model/                  # Theme, Block, Author, Credit
│   └── port/                   # 인터페이스 (inbound/outbound)
├── application/                # Use Cases
│   ├── theme/                  # GenerateThemeUseCase, GetThemeUseCase
│   ├── manuscript/             # ParseManuscriptUseCase
│   ├── credit/                 # DeductCreditUseCase, GrantCreditUseCase
│   └── auth/                   # (Phase 3)
├── adapter/
│   ├── inbound/http/           # Controllers
│   └── outbound/
│       ├── persistence/        # Prisma Repository
│       └── ai/                 # Claude API 클라이언트
├── infrastructure/
│   ├── prisma/                 # schema.prisma, migrations
│   └── config/                 # 환경변수
└── lib/
    ├── claude.ts               # Claude API 래퍼
    └── md-parser.ts            # MD → Block[] 파서
```

---

## 4. DB 스키마 (Prisma)

기획서의 data-model.md 참조. 핵심 테이블:

```prisma
model Author {
  id        String   @id @default(uuid())
  slug      String   @unique
  name      String
  email     String   @unique
  theme     Theme?
  works     Work[]
  credits   Int      @default(3)
  createdAt DateTime @default(now())
}

model Theme {
  id              String   @id @default(uuid())
  author          Author   @relation(fields: [authorId], references: [id])
  authorId        String   @unique
  preset          String   @default("midnight")
  overrides       Json?
  rawDescription  String?
  updatedAt       DateTime @updatedAt
}

model Work {
  id          String    @id @default(uuid())
  author      Author    @relation(fields: [authorId], references: [id])
  authorId    String
  slug        String
  title       String
  subtitle    String?
  description String?
  episodes    Episode[]
  createdAt   DateTime  @default(now())
}

model Episode {
  id       String   @id @default(uuid())
  work     Work     @relation(fields: [workId], references: [id])
  workId   String
  slug     String
  title    String
  subtitle String?
  orderNum Int
  blocks   Json
  rawMd    String
  createdAt DateTime @default(now())
}

model CreditLog {
  id        String   @id @default(uuid())
  authorId  String
  amount    Int
  reason    String
  createdAt DateTime @default(now())
}

model SignupHistory {
  providerId    String   @id
  firstSignupAt DateTime @default(now())
  signupCount   Int      @default(1)
}
```

---

## 5. API 엔드포인트

| Method | Path | 용도 | Phase |
|--------|------|------|-------|
| POST | `/api/themes/generate` | Claude API로 테마 생성 (1크레딧 차감) | 1 |
| GET | `/api/themes/:authorSlug` | 작가 테마 조회 | 1 |
| POST | `/api/manuscripts/parse` | MD 텍스트 → Block[] 파싱 | 1 |
| GET | `/api/authors/:slug` | 작가 공간 데이터 (테마 + 작품 목록) | 1 |
| GET | `/api/works/:authorSlug/:workSlug` | 작품 데이터 | 1 |
| GET | `/api/episodes/:authorSlug/:workSlug/:episodeSlug` | 에피소드 데이터 | 1 |
| POST | `/api/auth/register` | 작가 가입 | 3 |
| POST | `/api/auth/login` | 로그인 | 3 |

---

## 6. Claude API 테마 생성 — 핵심 로직

### 래퍼 함수 (YECHANGPE 패턴)

```typescript
// src/lib/claude.ts
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function askClaude(
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number }
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: options?.maxTokens ?? 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  })
  return response.content[0].type === "text" ? response.content[0].text : ""
}
```

### 테마 생성 프롬프트

시스템 프롬프트에 아래를 포함:
- "당신은 웹 테마 디자인 전문가입니다"
- AuthorTheme JSON 스키마 (docs/theme-spec.md 참조)
- 허용된 값 범위 (색상: hex, fontBody: serif/sans-serif/monospace 등)
- "반드시 JSON으로만 응답하세요. 다른 텍스트는 포함하지 마세요."

### JSON 파싱 에러 복구

```typescript
function tryParseJSON(raw: string): AuthorTheme {
  try { return JSON.parse(raw) } catch {}
  // trailing comma 제거
  const cleaned = raw.replace(/,\s*([\]}])/g, "$1")
  try { return JSON.parse(cleaned) } catch {}
  // 마지막 유효한 }까지 잘라내기
  const lastBrace = raw.lastIndexOf("}")
  if (lastBrace > 0) {
    try { return JSON.parse(raw.substring(0, lastBrace + 1)) } catch {}
  }
  throw new Error("테마 JSON 파싱 실패")
}
```

---

## 7. MD 파서 이관

DeerDevil의 `scripts/parse-md.ts`를 서버사이드 함수로 변환:

- 원본 위치: `/Users/sokol/Desktop/Git/ProjectGrimoire/grimoire-web/scripts/parse-md.ts`
- 이관 위치: `grimoire-server/src/lib/md-parser.ts`
- 입력: MD 텍스트 문자열
- 출력: `Block[]` 배열
- frontmatter 파싱 포함 (slug, type, num, subtitle, description)

---

## 8. 크레딧 시스템

| 이벤트 | 크레딧 변동 | credit_logs reason |
|--------|-----------|-------------------|
| 가입 | +3 | `signup_bonus` |
| 첫 작품 등록 | +2 | `first_work_bonus` |
| 테마 생성 | -1 | `theme_generate` |
| 테마 재생성 | -1 | `theme_regenerate` |
| 구매 (5개) | +5 | `purchase_credit_5` |
| 관리자 부여 | +N | `admin_set_by_{adminId}` |

---

## 9. 참고 프로젝트 (코드 참고 시)

| 프로젝트 | 위치 | 참고 대상 |
|---------|------|----------|
| projectZenith (server) | `/Users/sokol/Desktop/Git/simple_project_zenith/project-zenith-server/` | Hexagonal 구조, Prisma, Docker, NestJS 패턴 |
| YECHANGPE | `/Users/sokol/Desktop/Git/YECHANGPE_urbanProjectAuto/` | claude.ts 래퍼, 프롬프트 엔지니어링, JSON 에러 복구 |
| Tajook | `/Users/sokol/Desktop/Git/Tajook/` | 크레딧 시스템, credit_logs, 재가입 방지, RLS |
| DeerDevil (파서) | `/Users/sokol/Desktop/Git/ProjectGrimoire/grimoire-web/scripts/parse-md.ts` | MD → Block[] 파서 원본 |

---

## 10. 브랜치 전략

```
develop에서 feature/phase1-setup 브랜치 생성
작업 완료 후 develop에 --no-ff 머지
```

커밋 메시지: `{type}: {한국어 메시지}`

---

## 11. 작업 순서 (권장)

1. NestJS 프로젝트 초기화 (`nest new`, npm)
2. Hexagonal 폴더 구조 생성
3. Prisma 설정 + 스키마 작성 (로컬 PostgreSQL 또는 Docker)
4. Claude API 래퍼 (`src/lib/claude.ts`)
5. 테마 생성 API (`POST /api/themes/generate`)
6. 테마 조회 API (`GET /api/themes/:authorSlug`)
7. MD 파서 이관 (`src/lib/md-parser.ts`)
8. 원고 파싱 API (`POST /api/manuscripts/parse`)
9. 크레딧 시스템 (차감/적립/로그)
10. 테스트 작성 (Jest)
11. Dockerfile 작성
12. develop 머지 + 푸시

---

## 12. 완료 기준

- [ ] NestJS 서버가 `npm run start:dev`로 실행됨
- [ ] `/api/themes/generate` 호출 시 Claude API로 테마 JSON 반환
- [ ] `/api/themes/:authorSlug` 호출 시 DB에서 테마 조회
- [ ] `/api/manuscripts/parse` 호출 시 MD → Block[] 변환
- [ ] 크레딧 차감/적립이 credit_logs에 기록됨
- [ ] Jest 테스트 전부 통과
- [ ] develop 브랜치에 머지 + GitHub 푸시
