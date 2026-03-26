# Changelog — grimoire-server

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
  - Theme 모델에 `bakedCssUrl` 추가 (§11 Baking 파이프라인 대비)
  - Work 모델에 `viewCount` 추가
  - Episode 모델에 `viewCount`, `sourceFormat` 추가
  - SocialAccount 모델 신규 (소셜 로그인 1:N 연동)
- AuthorRepositoryPort: create 메서드에 passwordHash 파라미터 추가
- app.module.ts: JwtModule, AuthController, AuthUseCase, JwtAuthGuard 등록

#### Stats
- 테스트: 60개 통과 (기존 43 + 신규 17)

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
- Jest 테스트 43개 통과 (json-parser, md-parser, generate-theme, credit)
- Dockerfile (멀티스테이지 빌드 + docker-entrypoint.sh)
- Health check 엔드포인트: `GET /api/health`
