# Changelog — grimoire-server

## [0.30.0] - 2026-05-03

### Feat — publishTheme bakedCssUrl 절대화 (P1-#7, sprint-baked-css-url-absolute)

#### Changed
- `application/theme/bake-theme.usecase.ts` — Blob 비활성/실패 시 `cssUrl = null` 박제 (이전: `/api/themes/css/{slug}` 상대 경로 박제). 반환 시그니처 `Promise<{ cssUrl: string | null; css: string }>`
- `domain/port/outbound/theme-repository.port.ts` — `updateBakedCssUrl(themeId, url: string | null)`로 시그니처 확장
- `adapter/outbound/persistence/prisma-theme.repository.ts` — 시그니처 확장 반영 (Prisma update는 이미 `string | null` 허용)
- `adapter/inbound/http/controller/theme.controller.ts` — `publish` / `findByAuthorSlug` / `resolveTheme` 응답에 `resolveBakedCssUrl()` 적용. 응답 `bakedCssUrl`은 항상 절대 URL (Blob URL 또는 `${PUBLIC_API_BASE_URL}/themes/css/{slug}` 폴백)
- `infrastructure/config/env.validation.ts` — `PUBLIC_API_BASE_URL` 필수 환경변수 + 절대 URL 형식 검증 (미설정/비절대 URL 시 부팅 차단)

#### Added
- `lib/url-resolver.ts` — `resolveBakedCssUrl(dbValue, slug, baseUrl)` 헬퍼. NULL/상대경로/빈문자 → 환경별 폴백 절대 URL, 절대 URL → 그대로 반환
- `lib/url-resolver.spec.ts` — 8건 (NULL/절대/트레일링슬래시/빈문자/상대경로/특수문자)
- `infrastructure/config/env.validation.spec.ts` — 5건 (필수 통과/누락/비절대 URL/누락 다른 키)
- `prisma/migrations/20260503130451_baked_css_url_clear_relative/migration.sql` — stale 상대 경로 row를 NULL로 일괄 정리 (DDL 0건, DML 단발, 무중단 OK)

#### Tests
- `application/theme/bake-theme.usecase.spec.ts` — Blob 미설정/업로드 실패 시 `cssUrl=null` + DB null 박제 검증 + 상대 경로 박제 회귀 차단 검증
- 전체 `npm test`: 494/494 PASS

#### Docs
- `docs/data-model.md` / `SCHEMA.md` — `themes.baked_css_url` 박제 정책 명시 ("절대 URL OR NULL", 상대 경로 박제 금지)
- `docs/environments.md` — `PUBLIC_API_BASE_URL` 환경변수 + 환경별 값 박제
- `docs/api-contract.md` — `GET /api/themes/{slug}` / `POST /api/themes/publish/{slug}` / `GET /api/themes/resolve/{slug}` 응답 `bakedCssUrl` 절대 URL 명세
- `MIGRATION.md` §7-Z — 본 마이그레이션 절차 + 롤백 정책 박제

#### Rationale
- 기존: localhost ↔ dev ↔ prod 환경 전환 시 DB의 상대 경로(`/api/themes/css/...`) 박제가 BFF hop을 강제 + CDN 캐싱 무효 + stale URL 잔존 위험
- 이번: server 단일 환경변수(`PUBLIC_API_BASE_URL`)로 응답 절대화 → DB는 절대 URL 또는 NULL만 박제, 환경 분리 강제. CDN 가용성 보존 (Blob 활성 시 절대 URL 그대로)
- 책 Ch 16 Anthropic 3-에이전트 패턴 (Initializer → Generator → Evaluator) 묶음 II 2회차 시범. Sprint 계약 정본: `reports/sprint-baked-css-url-absolute-progress.md`

### DB 마이그레이션: baked_css_url_clear_relative
- **목적**: stale 상대 경로 박제(`/api/themes/css/...`)를 NULL로 정리. 응답 시 server가 환경별 절대화 정책 전환
- **변경 내용**: DDL 없음 (스키마 무변경). DML 단발 — `UPDATE themes SET baked_css_url = NULL WHERE baked_css_url LIKE '/api/themes/css/%' OR baked_css_url = ''`
- **롤백 방법**: 일방향 (down 미작성). publishTheme 재호출로 자동 재박제 가능
- **적용 환경**: localhost ✓ / development - / production -

## [0.29.2] - 2026-04-26

### Feat — Anthropic SDK signal 완전 전파 (HARNESS §10 Phase 4)

#### Changed
- `lib/claude.ts:askClaude` options에 `signal?: AbortSignal` 추가, SDK `messages.create` 두 번째 인자 RequestOptions로 전달 → fetch abort 시 Anthropic API 호출도 즉시 cancel
- `domain/port/outbound/claude-api.port.ts:AskOptions`에 signal 필드 추가
- `adapter/outbound/ai/claude-theme.adapter.ts:ask` 시그니처 갱신 (signal 옵션 통과)
- `lib/rag/novel-analyzer.ts:AskFn / runAnalysis / checkConsistency / checkTone / checkCharacter` 모두 signal 인자 추가 (체인 끝까지 전달)
- `application/analysis/novel-analysis.usecase.ts` — checkXxx 호출 시 abortSignal 전달

#### Tests
- `lib/rag/novel-analyzer.spec.ts` — signal 전파 5건 (전달/미전달/abort 시 즉시 throw/일반 throw 재시도 보존)
- novel-analyzer 10/10 PASS, analysis usecase 30/30 PASS, sensor-server 4/4 PASS

#### Rationale
- 기존: 사용자 disconnect 시 abortableRace로 Promise는 reject되지만 백그라운드 Anthropic API call은 계속 실행 → 토큰 낭비
- 이번: SDK fetch에 signal 전달 → 즉시 cancel. 운영 토큰 절감 + UX 즉시 반영
- HARNESS §10 Phase 4 잔여 항목 해소

## [0.29.1] - 2026-04-24

### Fix — 테마 활성화 auto-evict (슬롯 가득 찬 상태에서 기본 테마 전환 경로 복구)

#### Changed
- `ThemeSlotUseCase.activateTheme` — 슬롯이 가득 찬 상태에서 활성화 시도 시 기존 기본 테마를 자동으로 슬롯에서 내린다 (auto-evict). 테마 설정 자체는 `is_slotted=false`로만 전환되고 삭제되지 않아 사용자가 나중에 다시 활성화 가능
- 예외적으로 기본 테마가 없거나 자기 자신인데 슬롯이 가득 찬 경우만 여전히 `BadRequestException`

#### Tests
- `theme-slot.usecase.spec.ts` — auto-evict 케이스 2건 추가, 기존 `슬롯 가득 차면 BadRequest` 케이스를 `기본 테마 없을 때만 BadRequest`로 정정
- 454건 전부 통과

#### Rationale
- free 플랜(슬롯 1)에서 테마 전환 경로 완전 차단 — 사용자는 "테마 2 쓰다가 3으로 바꾸려는데 안 바뀜"을 보고
- 슬롯은 용량 제한 개념이지만 "기본 테마 하나를 선택"한다는 사용자 의도는 단일 액션이어야 함. auto-evict로 UX 단순화

## [0.29.0] - 2026-04-24

### F4 보강 — AI 분석 리포트 영구 저장 + 히스토리 API

#### Added
- `prisma/schema.prisma` — `AnalysisReport` 모델 (authorId/workId/episodeId/workTitle/episodeTitle/types/results JSONB/creditsCharged/createdAt). 인덱스: `(author_id, created_at DESC)`, `(episode_id)`
- `prisma/migrations/20260424010000_add_analysis_reports/migration.sql` — 마이그레이션 신규
- `src/domain/port/outbound/analysis-report-repository.port.ts` — Port + AnalysisReport/Summary 타입
- `src/adapter/outbound/persistence/prisma-analysis-report.repository.ts` — Prisma 어댑터 (create / findByAuthor / findById)
- `NovelAnalysisUseCase.listReports(authorId)` + `getReport(authorId, reportId)` — 소유권 검증 포함
- `analysis.controller.ts` — `GET /api/analysis/reports` (Summary 목록) + `GET /api/analysis/reports/:id` (상세)
- `app.module.ts` — `AnalysisReportRepositoryPort` DI 바인딩

#### Changed
- `NovelAnalysisUseCase.analyzeEpisode` — 성공 시 reportRepo.create로 결과 영구 저장. 저장 실패는 catch로 보호(결과는 반환). 실패(환불 경로)는 저장하지 않음
- 생성자 시그니처에 `reportRepo: AnalysisReportRepositoryPort` 추가

#### Docs
- `docs/api-contract.md` — Analysis 섹션에 `/reports` 2건 추가
- `docs/ai-analysis-spec.md §5-1` 흐름 7단계(성공 시 저장) + §3-1-2 AnalysisReport 스키마 추가
- `docs/data-model.md` — `analysis_reports` 테이블 명세 + 관계도 갱신

#### Tests
- `novel-analysis.usecase.spec.ts` — reportRepo mock 추가, 저장/실패-저장안함/listReports/getReport 4건 추가
- 453건 전부 통과

#### Rationale
- 사용자 증상: 분석 완료 후 결과가 refreshUser 부작용으로 사라지고 재조회 수단이 없었음. 크레딧은 차감됐는데 결과는 증발
- 웹에서 useEffect 의존성 체인으로 setResults([]) 발생하는 버그 외에, 근본적으로 분석 결과를 한 번의 뷰어 세션 안에서만 보여주는 설계가 부적절
- → 결과는 DB 저장 + 분석 기록 화면에서 언제든 재조회 가능하도록 설계 전환

## [0.28.0] - 2026-04-24

### F4 — AI 일관성 분석 Q1=(a) 에피소드 ID 모드 전환 (벤치마크 정합)

#### Changed
- `NovelAnalysisUseCase.analyzeNewEpisode` 제거 → `analyzeEpisode(authorId, episodeId, types?, abortSignal?)` 신규
  - DB의 `Episode.rawMd` 사용 (작가가 본문 재입력 강제 금지 — `docs/ai-analysis-spec.md §6-1` Claude Projects 벤치마크 정합)
  - 자기 자신 청크는 RAG에서 자동 제외 (excludeEpisodeId = episodeId, self-reference 환각 방지)
  - 소유권 검증: Episode → workId → Work.authorId === JWT sub (IDOR 방지, 크레딧 차감 전 수행)
  - rawMd 길이 < 10자 BadRequest (분석 의미 없음)
- `analysis.controller.ts` `/check` body: `{ episodeId, types? }` (이전 `{ workId, newEpisodeText, types?, episodeId? }` 폐기)
- `runAnalysis` 시그니처 — `excludeEpisodeId` 필수 인자로 변경, TOP_K_FETCH 30 고정
- `lib/abort.ts` 주석 — `analyzeNewEpisode` → `analyzeEpisode` 정정

#### Docs Sync
- `docs/ai-analysis-spec.md §5-1` — 흐름 0~6단계 재작성 (소유권→차감→RAG→분석→환각검증→환불)
- `docs/api-contract.md` POST /api/analysis/check — 크레딧 1→3 정정 + body 새 시그니처 + 에러 케이스
- 양 레포 동기화 완료

#### Test Updates
- `novel-analysis.usecase.spec.ts` — `analyzeNewEpisode` describe → `analyzeEpisode` 재작성
  - `findEpisodeById` mock 추가, makeEpisode/makeWork 헬퍼 도입
  - 신규 describe "소유권 검증 (IDOR 방지)" 4건 추가 (Episode 없음 / Work 없음 / 타인 작품 / rawMd 짧음)
  - 모든 케이스 인자 형식 갱신, 446건 전부 통과

#### Rationale
- 사용자 지적: "Claude 채팅 프로젝트 개념"이 본 기능의 정본 벤치마크인데 분석 화면이 본문 복붙을 강제 → 벤치마크 위반
- `research/FEATURE_AI_ANALYSIS.md §1` "이 경험을 그리모어 플랫폼에 내장하겠다는 것" 명시 + `ai-analysis-spec.md §6-1` 매핑표(파일=Episodes 자동 인덱싱) 정합
- 같은 그리모어 안에서 채팅(`/dashboard/chat`)은 벤치마크를 따르는데 분석만 이탈했던 갭 정정

## [0.27.0] - 2026-04-19

### F1/F2/F3 — §0 크레딧-원가 마진 전면 정합화

#### Changed
- **F1 기본 패키지 인상**: CREDIT_PRODUCTS.credit-5 price ₩1,000→₩2,000, priceUsd 99센트→149센트. Polar 고정수수료 $0.30 잠식(44%) 해소 → 안전배수 1.84× → 3.49× PASS
- **F2 AI 분석 크레딧 확정**: ANALYSIS_CREDIT_COST=3 신규 상수, CreditReason.NOVEL_ANALYSIS / NOVEL_ANALYSIS_REFUND 추가. `NovelAnalysisUseCase.analyzeNewEpisode`에 authorId 파라미터 + 시작 전 3 차감 + 실패 시 전액 환불 로직. 컨트롤러 `/analysis/check`가 `req.user.sub` 전달 (IDOR 방지)
- **F3 ai-analysis-spec §8 현행화**: "분석 1회 ≈ 5원" 삭제 → Sonnet 4.6 ₩60.4 / Haiku 4.5 ₩20.6 양 기준 병기. 크레딧 차감 정책 표 추가
- **docs/ai-cost-table.md 전면 재작성**: PAYAPP 3.5% 가정 삭제, Polar 2.9%+$0.30 정본 반영. TBD 2건 제거. 베스트 기준 모든 기능 PASS 확인

#### Test Updates
- `payment.usecase.spec.ts` — credit-5 기대값 ₩1,000→₩2,000, AI_COST_PER_THEME_KRW 12→14.6
- `polar.adapter.spec.ts` — webhook amount 99센트→149센트 / ₩1,000→₩2,000
- `novel-analysis.usecase.spec.ts` — mockCreditRepo 추가, 크레딧 차감/부족/환불 3 케이스 추가, 전체 호출에 authorId 첫 인자 추가

#### Rationale
- 결제사 전환(PAYAPP→Polar) 당시 고정수수료($0.30≈₩442) 구조 변경이 기본 패키지 마진을 조용히 잠식
- 4/18 Cost Audit에서 CRITICAL 3건 드러남 (COST_AUDIT_REPORT §3 정정 참조)
- 사용자가 "인상" 방안 선택 (vs 최소 결제 ₩3,000 폐지 방안)

## [0.26.0] - 2026-04-19

### Title 정규화 파이프라인 도입 (Safari Hangul shaping 버그 회피)

#### Added
- `domain/model/title-normalizer.ts` — `normalizeTitle(raw)` 순수 함수. 언더스코어→공백, 연속 공백 단일화, trim. 단일 진실 공급원 (Hexagonal domain layer)
- `normalizeTitle.spec.ts` — 13개 케이스 (언더스코어/공백/em-dash 보존/idempotent/non-string 방어)
- `ParseManuscriptUseCase` 응답에 `normalizedTitle` 필드 추가 (MD/TXT/DOCX/HWP/HWPX 전 경로)
- `docs/api-contract.md` — `/manuscripts/parse`, `/manuscripts/upload` 응답에 `normalizedTitle` 명세
- `docs/glossary.md` — Title Normalization / normalizedTitle 용어 정의

#### Fixed
- `WorkManagementUseCase.createEpisode` — DB 저장 직전 `normalizeTitle(input.title)` 강제 (클라이언트 신뢰 제거)
- `WorkManagementUseCase.reuploadEpisode` — 전달된 title 정규화
- `WorkManagementUseCase.createWork` / `updateWork` — 작품 제목도 동일 원리로 정규화
- 에피소드 slug 생성 기반을 정규화된 title로 변경 (기존: raw input.title)

#### Rationale
- Safari의 `italic + Noto Serif KR faux synthesis` 조합에서 한글+Latin+언더스코어 밀착 문자열의 자모 분해 버그 존재
- 파일명이 그대로 title로 박히면 조건에 걸림 → 정규화 파이프라인으로 DB 무결성 보장
- 사슴악마 17개 기존 에피소드 전부 깨끗 확인 → 마이그레이션 불필요

## [0.25.0] - 2026-04-17

### 테마 시스템 전수 수정 + 에이전트 자율 실행 + 배포 자동화

#### Added
- POST /themes/:themeId/activate — 작가 공간 기본 테마 활성화 (슬롯 자동배정)
- PATCH /themes/works/:workId/theme — 작품별 테마 배정
- getSlotInfo에 defaultThemeId 포함
- AI 테마 생성 시 tagline/headerSubtitle을 자동 이름으로 사용
- deploy-prod.sh 수동 배포 스크립트 (GitHub Actions 우회)
- pre-push hook에 docs-sync 센서 연결
- 에이전트 프롬프트 자율 실행 전환 (developers, qa, visual-canon-keeper)

#### Fixed
- 기존 작가 테마 is_slotted=false + default_theme_id=null 수정 (마이그레이션)
- 보안 헤더 SameSite strict 통일 + helmet 커스터마이징
- 슬롯 제거 시 defaultThemeId 고아 참조 정리
- 시스템 테마 슬롯 배정 차단 (source=system)
- CSS 엔드포인트 @Throttle(30/min) 추가
- 스키마 기본값 "기본 테마" → "내 테마"

#### Changed
- assignSlot: 첫 슬롯 시 자동 활성화
- seed-all.ts: isSlotted=true + defaultThemeId 설정

## [0.24.0] - 2026-04-12

### 테스트 완성 + P1/P2 관리자 + 통계 시드 + 정비

#### Added
- UseCase 테스트 3건 추가 (chat, plan, theme-slot) — 총 403 tests, 33 suites
- 관리자 P1: 시계열 통계 차트, 공지사항 CRUD, 추천 작품 큐레이션
- 관리자 P2: 수익 대시보드, 시스템 테마 프리셋 관리
- 통계 시드 스크립트 (scripts/seed-stats.ts) — 3환경 실행 완료

#### Fixed
- inhouse DB _prisma_migrations 중복 레코드 정리

#### DB Migration
- 20260411400000_add_announcements_featured — 공지사항 + 추천 작품 테이블

## [0.23.0] - 2026-04-11

### 관리자 패널 + 보안 인프라 + 운영 정비

#### Added
- 관리자 패널 10탭 (통계/사용자/콘텐츠/제재/신고/댓글/결제/접근로그/설정/감사로그)
- 관리자 전용 로그인 (POST /admin/login, reCAPTCHA 없음, role=admin 검증)
- 사용자 제재 시스템 (경고~영구정지, 로그인 차단, 만료 자동 해제)
- 콘텐츠 신고 시스템 (접수→승인/기각, 승인 시 자동 비공개)
- 시스템 설정 패널 (점검모드, reCAPTCHA, 레이트리밋 — 재배포 없이 변경)
- 보안 접근 로그 (access_logs — 회원가입/로그인/관리자 IP·UA 기록)
- 감사 로그 (admin_audit_logs — 모든 관리자 행위 자동 기록)
- 데드락 방지 (크레딧 트랜잭션 SELECT FOR UPDATE 패턴)
- 에피소드 재업로드 API (PATCH /episodes/:id/reupload)
- 관리자 계정 시드 스크립트 (scripts/seed-admin.ts)

#### Changed
- 크레딧 상품 기획서 기준 정렬 (10/30/100 → 5/20/50)
- convertToKrw() 구현 (상품 매핑 + 고정환율 폴백)
- theme-baker CSS 변수 --u-* → --g-* 통일 (프론트엔드 매칭)
- BakeThemeUseCase: Blob Storage CDN 업로드 + API 폴백
- 업로드 페이지 textarea 제거 (원칙 위반 수정)

#### Infrastructure
- Azure Blob Storage (grimoire0storage) 생성 + 3환경 환경변수 주입
- Polar 상품 API 업데이트 (5/20/50)
- 테스트 쿠폰 삭제 (GRIMOIREDEV3545F21975)
- 의심 계정 "으어어어" 추적 + 삭제

#### DB Migration
- 20260411000000_unify_timestamp_to_timestamptz — 전 테이블 TIMESTAMPTZ 통일
- 20260411100000_add_admin_audit_log — 감사 로그 테이블
- 20260411200000_add_access_log — 접근 로그 테이블
- 20260411300000_add_sanctions_reports_settings — 제재/신고/설정 테이블

#### Tests
- 관리자 UseCase 유닛테스트 12건 추가 (총 377)
- 관리자 E2E 테스트 (Playwright) 4건

## [0.22.0] - 2026-04-09

### Polar 결제 3환경 배포 + inhouse DB 복구

#### Fixed
- Polar SDK webhooks import 경로 버그 수정 — `@polar-sh/sdk/dist/commonjs/webhooks` → `@polar-sh/sdk/webhooks`. exports map의 `./*` → `./dist/commonjs/*.js` 패턴 때문에 컨테이너에서 `dist/commonjs/dist/commonjs/webhooks.js`로 이중 매핑되어 MODULE_NOT_FOUND로 부팅 실패했던 버그. 로컬은 fallback으로 통과해서 감지되지 않음.

#### Infrastructure
- Polar webhook endpoint 3개 환경별 분리 등록 (dev/inhouse/prod), 각 endpoint 고유 secret
- Azure Container Apps 3환경 POLAR_* 환경변수 주입 (ACCESS_TOKEN, SERVER, ORGANIZATION_ID, PRODUCT_BASIC/POPULAR/BEST, WEBHOOK_SECRET)
- inhouse DB Prisma P3009 묵은 장애 복구 — `20260326091237_init` 실패 기록 해소 + 스키마 diff 수동 정규화(payments/episodes/comments/likes) + 9개 pending 마이그레이션 applied 마킹

#### Verified
- dev/inhouse/prod 결제 end-to-end 검증 완료 (100% 할인 쿠폰 `GRIMOIREE2ETEST` 사용)
  - /payments/initiate → Polar checkout URL → checkout 완료 → webhook 수신 → 트랜잭션 원자 처리 → 크레딧 +10 증가
- 운영 curl HTTP 전수검사 25/25 통과

---

## [0.21.0] - 2026-04-08

### 테마 시스템 로직 구멍 수정

#### Security
- 활성(슬롯) 테마 삭제 방지 — isSlotted=true면 BadRequestException
- defaultThemeId 고아 참조 정리 — 테마 삭제 시 null 처리
- 프리셋 복사 중복 방지 — JSON.stringify 의존 제거, preset명+source 기반 비교

#### Added
- PUT /themes/:themeId에 name 파라미터 지원 (테마 이름 변경)

---

## [0.20.0] - 2026-04-08

### 보안 수정 — IDOR + Race Condition + DOCX 크기 제한

#### Security
- GenerateThemeDto에서 authorId 필드 제거 (IDOR 방지 완결)
- 크레딧 차감 Race Condition 방어 — 메모리 선 체크 제거, adjustCredits의 $transaction 원자적 체크에 의존
- DOCX 파서: mammoth 변환 결과 50MB 초과 시 거부 (Zip Bomb 방어)
- UseCase 파서 에러를 BadRequestException(400)으로 변환 (기존 500 방지)

#### Added
- 보안 테스트 3건 추가 (DOCX 크기 초과, mammoth 에러, HWPX Zip Bomb)

---

## [0.19.0] - 2026-04-08

### 테마 시스템 정합성 정리 — 데드코드 제거 + 문서 보강

#### Changed
- themePresets에서 deerDevil, system-default 제거 (프리셋 아닌 데드코드)
- resolveTheme(), normalizeOverrides() 미사용 함수 제거
- isSlotted 기본값 true → false (기획 의도: 보관 상태로 생성)
- theme-spec.md 프리셋 표 8종 완성 (Magazine, Gallery, Minimal 추가)
- glossary.md 프리셋 정의 보강 (deerDevil 제외 명시)
- midnight 주석 수정 (book 아이콘, 보라 accent)

---

## [0.18.0] - 2026-04-07

### 시스템 테마 DB 통합 + 프리셋 API

#### Added
- 시스템 테마 8종 DB INSERT (authorId=null, source=system)
- GET /themes/presets — 시스템 프리셋 목록 API (deerDevil, system-default 제외)
- POST /themes/from-preset — 프리셋에서 테마 생성 API

#### Changed
- SYSTEM_DEFAULT_THEME 하드코딩 제거 → DB 시스템 테마(midnight) 폴백
- resolveTheme() 머지 로직 제거 — overrides가 곧 완전한 테마
- 슬롯 제한값 기획서 기준 수정 (Pro=3, Premium=8)
- 시스템 테마 수정/삭제 차단 (ForbiddenException)

---

## [0.17.0] - 2026-04-07

### 테마 시스템 리팩토링 — source 필드 + deerDevil 분리 + 개별 조회 API

#### Added
- Theme 모델에 `source` 필드 추가 (system/ai/user) — 테마 출처 명시적 구분
- GET /themes/detail/:themeId — 개별 테마 상세 조회 API (인증, 소유권 확인, resolved theme 반환)
- GetThemeUseCase.findById — 소유권 확인 포함 개별 조회
- dividerIcon/headerIcon에 "book" 옵션 추가

#### Changed
- deerDevil/midnight 프리셋 독립 분리 (midnight: book 아이콘+은보라 색상, deerDevil: antler 유지)
- generate-theme: source='ai' 기록
- updateOverrides: source='user' 기록
- seed-themes: deerdevil 작가 preset을 'deerDevil'로 변경

---

## [0.16.0] - 2026-04-07

### AI 채팅 + 구독 플랜 + 시맨틱 캐싱

#### Added
- AI 채팅 기능 — RAG 기반 작가 어시스턴트 (세션/메시지/히스토리 API 5개)
- 자정 프로젝트 메모리 자동 재생성 (MemoryRegenerationService, @Cron)
- 에피소드 매니페스트 자동 주입 (시스템 프롬프트)
- 에피소드 업로드 시 자동 RAG 인덱싱 + Episode.isIndexed 필드
- Work.context/instructions 필드 — AI 채팅 시 고정 주입
- 구독 플랜 시스템 (free/pro/premium) + Author.plan/planExpireAt
- 테마 슬롯 관리 (Theme.isSlotted, 활성/보관, 슬롯 용량 제한)
- 시맨틱 캐싱 서비스 (분석+테마+채팅 공용, pgvector 유사도 검색)
- POST /admin/authors/:authorId/plan — 관리자 플랜 수동 설정
- GET /plan — 플랜 정보 조회
- @nestjs/schedule 패키지 추가

#### Changed
- Theme 모델: name, isSlotted 필드 추가
- Author 모델: plan, planExpireAt 필드 추가
- 문서 일괄 현행화 (api-contract, data-model, glossary, SCHEMA, theme-spec)

---

## [0.15.0] - 2026-04-02

### 비로그인 좋아요/댓글 지원 (디시인사이드 스타일)

#### Added
- OptionalAuthGuard — 토큰 선택적 인증 (비로그인 통과)
- IP 추출 유틸 (X-Forwarded-For → X-Real-IP → req.ip)
- 익명 좋아요 — IP + 쿠키 기반 중복 방지, 취소 불가
- 익명 댓글 — 닉네임 + 비밀번호 (bcrypt 해시), 비번으로 삭제
- GET /social/likes/:episodeId/status — 좋아요 상태+수 조회 (로그인/비로그인 모두)
- 익명 관련 테스트 12개 추가 (social.usecase.spec.ts)

#### Changed
- Like 모델: authorId nullable, ipAddress/cookieId 컬럼 추가
- Comment 모델: authorId nullable, nickname/passwordHash/ipAddress 컬럼 추가
- 좋아요/댓글 API: JwtAuthGuard → OptionalAuthGuard 변경
- docs/api-contract.md, docs/data-model.md 업데이트

---

## [0.14.0] - 2026-04-01

### 테마 resolveTheme + 프리셋 체계 + 결제 리팩터링

#### Added
- resolveTheme 함수 도입 — preset 기본값 + overrides를 merge한 완전한 테마 객체 반환
- theme-presets.ts — 9개 프리셋 정의 (midnight, parchment, morning, neon, cream, magazine, gallery, minimal, deerDevil)
- custom preset 처리 — overrides 기반, 누락 필드는 defaultTypography/defaultUI로 보완
- layout → episodeListLayout 하위 호환 매핑 (normalizeOverrides)
- navStyle 삭제 처리 (삭제된 필드 자동 제거)
- UI 세부 조정 필드 12개 추가 (tabPillRadius, labelLetterSpacing, cardWatermarkOpacity, cardHoverLift, cardCtaText, subtitleStyle, episodeLabelFormat, sectionSpacing, showPreface, showAfterword, showProfileTab, subscribeButtonStyle)

#### Changed
- 결제 모듈 payappTradeNo → externalTransactionId 리팩터링
- docs/theme-spec.md 동기화 (web 정본 → server 복사, episodeListLayout 리네이밍 + 새 필드 반영)

---

## [0.13.0] - 2026-03-31

### 에피소드 상태값 시스템 + 만료 공유 링크

#### Added
- Episode 모델에 status(upload/public/nonPublic/shared), sharedToken, sharedExpireAt 필드 추가
- EpisodeStatus 도메인 타입 + 접근 제어 로직 (ContentUseCase)
  - upload: 작가 본인만 조회
  - public: 누구나 조회
  - nonPublic: 로그인 사용자만
  - shared: 공유 토큰으로만 접근 (만료 시간 12h/24h/48h/무한)
- OptionalJwtAuthGuard — 토큰 있으면 파싱, 없어도 통과 (content.controller.ts)
- API 엔드포인트 3개:
  - `PATCH /works/:workId/episodes/:id/status` — 상태 변경 (작가 전용)
  - `POST /works/:workId/episodes/:id/share` — 공유 링크 생성 (작가 전용)
  - `GET /shared/:token` — 공유 링크 접근 (비로그인 가능)
- 서버 테스트 14개 추가 (ContentUseCase 상태별 접근 + WorkManagement 상태/공유/만료)
- 대시보드: 작품별 에피소드 목록 펼침 + 상태 배지 + 상태 변경 드롭다운 + 공유 링크 모달
- `/shared/[token]` 프론트엔드 라우트 (공유 에피소드 뷰어)

#### Changed
- `getWorkDetail()`에 requestAuthorId 파라미터 추가 — 작가 본인이면 upload 에피소드 포함
- `getEpisode()`에 status 기반 접근 제어 추가
- EpisodeSummary에 status 필드 추가
- content.controller.ts에 OptionalJwtAuthGuard 적용 (GET 요청에서도 로그인 여부 감지)

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
