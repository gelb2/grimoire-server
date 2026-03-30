# CLAUDE.md — grimoire-server

> NestJS + Hexagonal 아키텍처 백엔드 API.
> 테마 생성(Claude API), 원고 파싱, 작가 인증, 데이터 관리.

---

## 1. 개요

작가의 텍스트 설명을 Claude API로 해석하여 테마를 생성하고,
MD/TXT/DOCX 원고를 파싱하여 블록 데이터로 변환하는 백엔드 서버.

현재 구현 현황은 `TECH_STATUS.md` 참조.

---

## 2. 필수 참조 문서 (읽는 순서)

| 순서 | 문서 | 역할 |
|------|------|------|
| 1 | `docs/api-contract.md` (정본) | API 엔드포인트 전체 명세 |
| 2 | `docs/data-model.md` (정본) | DB 스키마 정의 |
| 3 | `docs/theme-spec.md` | 테마 파라미터 (Claude API 응답 형식) |
| 4 | `docs/environments.md` (정본) | 빌드 환경 + Azure 배포 |
| 5 | `docs/glossary.md` (정본) | 용어 정의 |
| 6 | `SCHEMA.md` | Prisma 스키마 구현 상세 |
| 7 | `INFRASTRUCTURE.md` | Azure 인프라 구성 |
| 8 | `SECURITY.md` | 보안 정책 + 배포 전 체크리스트 |
| 9 | `TECH_STATUS.md` | 현재 구현 상태 + 배포 현황 |
| 10 | `TESTING.md` | 테스트 전략 |

---

## 3. 공통 규칙

- **코드**: 영어 / **주석/커밋/문서**: 한국어
- **패키지 매니저**: npm
- 테스트 미통과 상태로 커밋 금지

### 문서 동기화 체크리스트 (커밋 전 확인)

- Controller에 엔드포인트 추가/삭제 → `docs/api-contract.md` 업데이트
- Prisma 스키마 변경 → `docs/data-model.md` + `SCHEMA.md` 업데이트 (절차: `MIGRATION.md` 참조)
- 환경변수/배포 변경 → `docs/environments.md` + `INFRASTRUCTURE.md` 업데이트
- 용어 추가 → `docs/glossary.md` 업데이트
- 아키텍처 결정 변경 (트랜잭션, 동시성, 캐싱 등) → `ADR.md` 업데이트

---

## 4. 기술 스택

| 항목 | 기술 |
|------|------|
| 프레임워크 | NestJS |
| 언어 | TypeScript (strict) |
| ORM | Prisma |
| DB | PostgreSQL (Azure Database) |
| AI | Anthropic Claude API (SDK) |
| 컨테이너 | Docker (Azure Container Apps) |
| Rate Limiting | @nestjs/throttler |
| DOCX 파싱 | mammoth |
| 테스트 | Jest |

> 정확한 버전은 `package.json` 참조.

---

## 5. 아키텍처 — Hexagonal

### 규칙

Hexagonal Architecture를 따른다. 새 기능 추가 시 아래 순서를 지킨다:

1. `domain/model/` — 값 객체/도메인 모델 정의
2. `domain/port/outbound/` — Repository/외부 서비스 인터페이스 정의
3. `adapter/outbound/` — 인터페이스 구현 (Prisma, 외부 API 등)
4. `application/` — UseCase 비즈니스 로직
5. `adapter/inbound/http/controller/` — HTTP 엔드포인트

### 폴더 구조

```
src/
├── domain/                        # 순수 비즈니스 로직
│   ├── model/                     # 값 객체
│   └── port/outbound/             # Repository + AI + Payment 포트 인터페이스
├── application/                   # Use Cases (모듈별 1 디렉토리)
├── adapter/
│   ├── inbound/http/
│   │   ├── controller/            # HTTP 컨트롤러
│   │   ├── dto/                   # Request/Response DTO
│   │   └── guard/                 # JwtAuthGuard
│   └── outbound/
│       ├── persistence/           # Prisma Repository 구현
│       ├── ai/                    # ClaudeThemeAdapter
│       └── payment/               # PayappAdapter
├── infrastructure/
│   ├── prisma/                    # PrismaService
│   └── config/                    # 환경변수 검증
├── lib/                           # 유틸리티 (파서, AI 래퍼, RAG)
├── app.module.ts                  # 루트 모듈 (포트-어댑터 DI 바인딩)
└── main.ts                        # 부트스트랩
```

> 현재 구현된 컨트롤러/UseCase 목록은 `src/` 디렉토리 직접 확인.
> 아키텍처 레이어별 수량은 `TECH_STATUS.md` 참조.

---

## 6. Claude API 통합

### 래퍼 함수

`src/lib/claude.ts` — YECHANGPE 패턴. `askClaude(systemPrompt, userMessage, options?)` 시그니처.

### 테마 생성 흐름

```
POST /api/themes/generate
  → ThemeUseCase.generate(description)
  → askClaude(THEME_SYSTEM_PROMPT, description)
  → JSON 파싱 (에러 복구 포함)
  → DB 저장 (themes 테이블)
  → 응답: { themeId, preview: AuthorTheme }
```

테마 파라미터 스키마: `docs/theme-spec.md` 참조.

### JSON 파싱 에러 복구

`src/lib/json-parser.ts` — 3단계 복구 (직접 파싱 → trailing comma 제거 → 마지막 `}`까지 슬라이스).

---

## 7. API 엔드포인트

전체 API 명세: `docs/api-contract.md` 참조.

---

## 8. DB 스키마

- Prisma 스키마: `prisma/schema.prisma` 참조
- 스키마 설명: `SCHEMA.md` 참조
- 공유 스키마 문서: `docs/data-model.md` 참조

---

## 9. 결제/크레딧 — 원자성 원칙

> **절대 규칙:** 돈이 오가는 로직은 반드시 단일 DB 트랜잭션으로 묶는다.

결제 웹훅 성공 시 아래 3개를 `$transaction`으로 원자 처리:
1. Payment 상태 → completed
2. Author 크레딧 증가
3. CreditLog 기록

**하나라도 실패하면 전부 롤백.** 중간 상태(돈은 냈는데 크레딧 없음) 절대 불가.

상세: `SECURITY.md` §3 "결제 원자성" 참조.
관련 코드: `src/application/payment/payment.usecase.ts` → `processWebhook()`

---

## 10. 빌드 환경

```bash
npm run start:dev        # 로컬 개발 (port 3000)
npm run build            # 프로덕션 빌드
npm test                 # Jest 테스트 (현재 수는 npm test 실행으로 확인)
docker build -t grimoire-server .
```

---

## 11. 참고 프로젝트

| 프로젝트 | 참고 대상 |
|---------|----------|
| DeerDevil | parse-md.ts (MD 파서), Block 타입 시스템 |
| projectZenith (server) | Hexagonal 구조, Prisma 설정, Docker, Azure Container Apps |
| YECHANGPE | claude.ts 래퍼, 구조화 프롬프트, JSON 에러 복구, 결과 캐싱 |
| Tajook | 크레딧 시스템, 재가입 방지, 감사 로그 |
