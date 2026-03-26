# Changelog — grimoire-server

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
