# Changelog — grimoire-server

## [0.12.0] - 2026-03-31

### 고전문학 전문 백필 + body limit + 배포 복구

#### Added
- 고전문학 전문 백필: 위키문헌 API → 단편소설 30건 + 이광수 재생 20편(371K자) + 채만식 냉동어(86K자)
- JSON body 크기 제한 2MB 확대 (장편소설 에피소드 업로드 대응, `src/main.ts`)
- 연구문서 3건 `docs/`로 이동 (TECH_REVIEW_SEMANTIC_CACHING, PAYMENT_RESEARCH, CHAT_FEATURE_RESEARCH)
- CLAUDE.md에 연구문서 참조 추가

#### Fixed
- GitHub Actions 리소스그룹 `grimoire-rg` → `zenith-rg` 복원 (전 환경 배포 실패 수정)
- INFRASTRUCTURE.md 리소스그룹명 일괄 수정

#### Removed
- 위키문헌 전문 없는 작품 11건 삭제 (이광수 7 + 채만식 3 + 나도향 1)

#### Deployment
- dev → inhouse → prod 순차 배포 완료 (각 단계 성공 확인 후 진행)

---

## [0.11.0] - 2026-03-30

### AI 프롬프트 확장 + 프리셋 시드 + 배포 완료

#### Added
- AI 테마 프롬프트 Phase 1/2 파라미터 해석 지침 추가 (타이포그래피 + 레이아웃 프리셋)
- seed-theme-presets.ts — 사슴악마 8개 프리셋 시드 스크립트
- db-sync.ts — prod → inhouse → dev DB 동기화 스크립트

#### Deployment
- inhouse → main 머지 완료
- grimoire-server-prod, grimoire-server-inhouse Docker 이미지 재빌드/배포

---
## [0.10.0] - 2026-03-28

### 크레딧 선물 + 테마 수정 API + HTML 파서

#### Added
- 크레딧 선물 기능 (CreditUseCase.gift + CreditController)
- 응원받는 작가 랭킹 API (GET /credits/ranking)
- 테마 커스텀 수정 API (PUT /themes/:themeId)
- HTML 파서 + 포맷별 파서 자동 분기 (md/html/txt)
- AdminGuard 유닛테스트 4건

#### Changed
- layout 값: "universe" → "series" (스크립트 + 문서 + DB)
- docs/theme-spec.md 동기화 (web 정본 → server 복사)
- TODO.md 정리 (완료 항목 제거, 장기 과제 분리)

## [0.9.0] - 2026-03-27

### 커버 이미지 + RAG 헥사고날 리팩토링

#### Added
- Azure Blob Storage 커버 이미지 업로드 (`PUT /api/works/:id/cover`)
- BlobStorageService 인프라 서비스 (환경변수 미설정 시 graceful 비활성화)
- Work.coverImage DB 필드 추가
- EmbeddingPort 인터페이스 + OpenAIEmbeddingAdapter (헥사고날)
- VectorStorePort 인터페이스 + PgVectorAdapter (헥사고날)
- ClaudeApiPort.ask() 범용 메서드 (테마 외 분석/요약 등)
- ACCOUNTS.md 서드파티 계정 현황 문서 (루트)

#### Refactored
- RAG 모듈 전면 리팩토링 — lib 직접 호출 → Port/Adapter 패턴
- NovelAnalysisUseCase: PrismaService 직접 의존 제거 → 포트 주입
- novel-analyzer.ts: askClaude 직접 호출 제거 → AskFn 파라미터 주입 (순수 함수)
- embeddings.ts/vector-db.ts 로직 → 어댑터 계층으로 이관

---

## [0.8.0] - 2026-03-27

### 최종 안정화 + 파일 업로드 + HWP 파서

#### Added
- 파일 업로드 엔드포인트 (Multer — md/txt/docx/hwp/hwpx)
- HWP/HWPX 파서 구현 (한글 워드프로세서 포맷 지원)
- CI/CD GitHub Actions 자동 배포 구축 (8개 워크플로우)
- 시드 데이터 원고 보강 (대제/중제/소제 + 실제 고전문학 텍스트)
- discovery API 페이지네이션 지원
- 전수검사 체크리스트에 보안 검증 항목 추가

#### Fixed
- Throttle/Debounce 전수점검 — 구독 Throttle 추가, 좋아요/구독 토글 원자화, 원고 파싱 Throttle 추가
- 인기 정렬에 createdAt 2차 정렬 추가 (에피소드 많은 작품 우선)
- 시드 스크립트 정리 (seed-all.ts 통합)

---

## [0.7.0] - 2026-03-26

### DeerDevil 테마 시스템 + 보안 강화

#### Added
- DeerDevil 테마 시스템 + 원본 파서 연결
- 테마 tagline + dividerIcon 필드 추가

#### Fixed
- CRITICAL 보안 8건 + HIGH 4건 수정
- 에피소드 type 필드 + DeerDevil slug 재구조화
- 스크립트 보안 + SOLID 정리
- MD 파서 원본 DeerDevil과 완전 일치시킴
- 문서 피라미드 리팩토링 + frontmatter/slug 버그 수정

---

## [0.6.0] - 2026-03-26

### CRITICAL 보안 수정 + 인프라

#### Fixed
- passwordHash 응답 노출 차단 (작가 조회 API에서 민감 필드 제거)
- admin 엔드포인트 인증 추가
- docker-entrypoint.sh 빌드 경로 유연화
- discovery API에 authorName/episodeCount/viewCount 포함
- ANTHROPIC_API_KEY를 선택적 환경변수로 변경

#### Added
- 작가 테마 시드 스크립트 (11명 테스트 계정)
- 고전 문학 30개 시드 스크립트
- DeerDevil DB 시드 스크립트
- Prisma 초기 마이그레이션 (dev DB 테이블 생성)
- 테마 시스템 전면 감사 + 서버 측 갭 수정

---

## [0.5.0] - 2026-03-26

### Phase 5 — 좋아요/구독/댓글 + RAG/Vector + Rate Limiting

#### Added
- 좋아요 토글 API (`POST /social/likes/:episodeId`)
- 구독 토글 API (`POST /social/subscriptions/:authorId`)
- 댓글 CRUD API (생성/목록/삭제)
- Like, Subscription, Comment Prisma 모델
- SocialRepositoryPort + PrismaSocialRepository
- 댓글 내용 검증 (1~500자, 공백 트림)
- RAG/Vector 소설 분석 시스템 (YECHANGPE 이식)
  - 작품 벡터 인덱싱 API
  - 설정 일관성 검사 API
  - 인덱싱 상태 조회 API
  - 텍스트 청킹 + OpenAI 임베딩 + 벡터 저장소
- 서버 Rate Limiting 전면 적용 (NestJS Throttler)

#### Fixed
- 전수조사: DTO 프로퍼티 definite assignment(!) 추가 (TS2564 해결)
- docs/api-contract.md 37개 전체 엔드포인트 문서화

---

## [0.4.0] - 2026-03-26

### Phase 4 — 북마크 + 검색 + 관리자 + 결제 + 인프라

#### Added
- 북마크 토글 + 목록 API (`/api/reader/bookmarks`)
- 읽기 진행도 저장/조회 API (`/api/reader/progress`)
- Bookmark, ReadingProgress Prisma 모델
- ReaderRepositoryPort + PrismaReaderRepository
- 작가 검색 API (`GET /api/discover/authors?q=`)
- 인기/최신 작품 API (`GET /api/discover/works/popular`, `/recent`)
- 관리자 통계 API (`GET /api/admin/stats`)
- 관리자 크레딧 부여 API (`POST /api/admin/credits`)
- 크레딧 상품 목록 API (`GET /api/payments/products`)
- PAYAPP 결제 웹훅 API (`POST /api/payments/webhook`)
- 크레딧 잔액 조회 API (`GET /api/payments/credits`)
- Payment Prisma 모델 + PaymentGatewayPort + PayappAdapter
- 결제 웹훅 원자성(Atomicity) 보장 — Prisma $transaction
- Azure 인프라 + CI/CD + Docker 완전 구축
  - Azure Container Apps (서버), Azure Database for PostgreSQL
  - Azure Container Registry + GitHub Actions CI/CD
  - 멀티스테이지 Docker 빌드 + docker-entrypoint.sh

#### Fixed
- 결제 웹훅 원자성(Atomicity) 보장 문서화

---

## [0.3.0] - 2026-03-26

### Phase 3 — Google OAuth + 작품 CRUD + 테마 Baking + DOCX 파서

#### Added
- Google OAuth 로그인 API (`POST /api/auth/google`)
- 작품 생성/수정/삭제 API (`POST/PATCH/DELETE /api/works`)
- 에피소드 생성/삭제 API (`POST /api/works/:workId/episodes`, `DELETE /api/episodes/:id`)
- WorkManagementUseCase + WorkManagement Controller
- DOCX 파서 (`src/lib/docx-parser.ts`) — mammoth 기반 HTML→Block[] 변환
- 테마 Baking API (`POST /api/themes/publish/:authorSlug`)
- Baked CSS 서빙 API (`GET /api/themes/css/:authorSlug`)
- theme-baker.ts — 테마 JSON → CSS Variables 변환
- PAYAPP 키 연동 완전체 + OAuth 슬러그 충돌 해결 + 환경변수 검증

---

## [0.2.0] - 2026-03-26

### Phase 2 — 인증 시스템 + DB 스키마 v0.2 + TXT 파서

#### Added
- JWT 기반 회원가입/로그인 API (`POST /api/auth/register`, `POST /api/auth/login`)
- 인증 프로필 조회 API (`GET /api/auth/profile`) + JwtAuthGuard
- bcryptjs 비밀번호 해싱
- TXT 파서 (`src/lib/txt-parser.ts`) — 줄바꿈 기반 문단 분리 + 구분선 인식
- 포맷 자동 감지 (`detectFormat`) — markdown/txt/html 판별
- AuthUseCase 테스트 6개 (register, login 정상/예외)
- txt-parser 테스트 11개 (문단 분리, 구분선, Windows 줄바꿈, 포맷 감지)

#### Changed
- DB 스키마 v0.2:
  - Author 모델에 `passwordHash` 추가
  - Theme 모델에 `bakedCssUrl` 추가 (Baking 파이프라인 대비)
  - Work 모델에 `viewCount` 추가
  - Episode 모델에 `viewCount`, `sourceFormat` 추가
  - SocialAccount 모델 신규 (소셜 로그인 1:N 연동)
- AuthorRepositoryPort: create 메서드에 passwordHash 파라미터 추가
- app.module.ts: JwtModule, AuthController, AuthUseCase, JwtAuthGuard 등록

---

## [0.1.0] - 2026-03-26

### Phase 1 — 백엔드 초기 구축

#### Added
- NestJS 프로젝트 초기화 (Hexagonal 아키텍처)
- Prisma 스키마: Author, Theme, Work, Episode, CreditLog, SignupHistory
- Claude API 래퍼 (`src/lib/claude.ts`) — YECHANGPE 패턴
- JSON 파싱 에러 복구 (`src/lib/json-parser.ts`) — 3단계 복구
- MD 파서 이관 (`src/lib/md-parser.ts`) — DeerDevil에서 서버사이드 전용으로
- 테마 생성 API: `POST /api/themes/generate` (Claude API → 테마 JSON)
- 테마 조회 API: `GET /api/themes/:authorSlug`
- 원고 파싱 API: `POST /api/manuscripts/parse` (MD → Block[])
- 작가 공간 API: `GET /api/authors/:slug`
- 작품/에피소드 조회 API: `GET /api/works/...`, `GET /api/episodes/...`
- 크레딧 시스템: 즉시 차감 + 감사 로그 (Tajook 패턴)
- Jest 테스트 (json-parser, md-parser, generate-theme, credit)
- Dockerfile (멀티스테이지 빌드 + docker-entrypoint.sh)
- Health check 엔드포인트: `GET /api/health`
