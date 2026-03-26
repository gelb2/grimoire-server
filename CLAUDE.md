# CLAUDE.md — grimoire-server

> NestJS + Hexagonal 아키텍처 백엔드 API.
> 테마 생성(Claude API), 원고 파싱, 작가 인증, 데이터 관리.

---

## 1. 개요

작가의 텍스트 설명을 Claude API로 해석하여 테마를 생성하고,
MD 원고를 파싱하여 블록 데이터로 변환하는 백엔드 서버.

---

## 2. 필수 참조 문서 (읽는 순서)

| 순서 | 문서 | 역할 |
|------|------|------|
| 1 | `docs/api-contract.md` (정본) | API 엔드포인트 명세 |
| 2 | `docs/data-model.md` (정본) | DB 스키마 정의 |
| 3 | `docs/theme-spec.md` | 테마 파라미터 (Claude API 응답 형식) |
| 4 | `docs/environments.md` (정본) | 빌드 환경 + Azure 배포 |
| 5 | `docs/glossary.md` (정본) | 용어 정의 |
| 6 | `SCHEMA.md` | Prisma 스키마 구현 상세 |
| 7 | `INFRASTRUCTURE.md` | Azure 인프라 구성 |

---

## 3. 공통 규칙

- **코드**: 영어 / **주석/커밋/문서**: 한국어
- **패키지 매니저**: npm
- 테스트 미통과 상태로 커밋 금지

---

## 4. 기술 스택

| 항목 | 기술 | 버전 |
|------|------|------|
| 프레임워크 | NestJS | 10.x |
| 언어 | TypeScript (strict) | 5.x |
| ORM | Prisma | 7.x |
| DB | PostgreSQL | Azure Database |
| AI | Anthropic Claude API (SDK) | 0.78+ |
| 컨테이너 | Docker | Azure Container Apps |
| 테스트 | Jest | - |

---

## 5. 아키텍처 — Hexagonal

```
src/
├── domain/                     # 순수 비즈니스 로직
│   ├── model/                  # 값 객체 (Theme, Block, Author)
│   └── port/                   # 인터페이스 (inbound/outbound)
├── application/                # Use Cases
│   ├── theme/                  # 테마 생성/조회
│   ├── manuscript/             # 원고 파싱/저장
│   └── auth/                   # 인증
├── adapter/
│   ├── inbound/http/           # Controllers (REST API)
│   └── outbound/
│       ├── persistence/        # Prisma Repository 구현
│       └── ai/                 # Claude API 클라이언트
├── infrastructure/
│   ├── prisma/                 # DB 설정
│   └── config/                 # 환경변수
└── lib/
    ├── claude.ts               # Claude API 래퍼 (YECHANGPE 패턴)
    └── md-parser.ts            # MD → Block[] 파서 (DeerDevil에서 이관)
```

---

## 6. Claude API 통합

### 래퍼 함수

```typescript
// src/lib/claude.ts
export async function askClaude(
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number }
): Promise<string>
```

### 테마 생성 흐름

```
POST /api/themes/generate
  body: { description: "어둡고 묵직한 A24 감성" }
    ↓
ThemeUseCase.generate(description)
    ↓
askClaude(THEME_SYSTEM_PROMPT, description, { maxTokens: 1024 })
    ↓
JSON 파싱 (에러 복구 포함)
    ↓
DB 저장 (themes 테이블)
    ↓
응답: { themeId, preview: AuthorTheme }
```

### JSON 파싱 에러 복구 (YECHANGPE 패턴)

```typescript
function tryParseJSON(raw: string): ThemeJSON {
  // 1. 직접 파싱 시도
  // 2. trailing comma 제거: /,\s*([\]}])/g
  // 3. 마지막 유효한 }까지 잘라내기
  // 4. 점진적 슬라이스
}
```

---

## 7. API 엔드포인트 (초안)

| Method | Path | 용도 |
|--------|------|------|
| POST | `/api/auth/register` | 작가 가입 |
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/themes/generate` | Claude API로 테마 생성 |
| GET | `/api/themes/:authorSlug` | 작가 테마 조회 |
| POST | `/api/manuscripts/parse` | MD 파일 → Block[] 파싱 |
| GET | `/api/authors/:slug` | 작가 공간 데이터 |
| GET | `/api/works/:authorSlug/:workSlug` | 작품 데이터 |
| GET | `/api/episodes/:authorSlug/:workSlug/:episodeSlug` | 에피소드 데이터 |

상세 명세는 `docs/api-contract.md` 참조.

---

## 8. 빌드 환경

```bash
npm run start:dev        # 로컬 개발 (port 3000)
npm run build            # 프로덕션 빌드
npm test                 # Jest 테스트
docker build -t grimoire-server .
```

---

## 9. 참고 프로젝트

| 프로젝트 | 참고 대상 |
|---------|----------|
| DeerDevil | parse-md.ts (MD 파서), Block 타입 시스템 |
| projectZenith (server) | Hexagonal 구조, Prisma 설정, Docker, Azure Container Apps |
| YECHANGPE | claude.ts 래퍼, 구조화 프롬프트, JSON 에러 복구, 결과 캐싱, 토큰 관리 |
