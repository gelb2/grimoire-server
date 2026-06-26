# SECURITY.md — grimoire-server

> 보안 정책 + 배포 전 체크리스트.
> **최신 감사일: 2026-04-17** (16항목 전수 실측 기반 최신화)
> **문서감사 정정 2차 (2026-06-27)**: §3 크레딧/결제 원자성을 크레딧 개편 CC-1~5 + CC-4 Phase 3 코드 실측에 동기화(`credit_logs`·`Author.credits`·`adjustCredits`·`completePaymentAtomically` 폐기 → `completePaymentWithPoints`·`CreditLedger`·`points_charged`·deficit 상계). §4 수동 배포 체크를 Azure→GCP로 전환(preflight.sh 8 step 실측).

---

## 1. 환경변수 보안

| 변수 | 민감도 | 관리 방식 |
|------|--------|----------|
| DATABASE_URL | 높음 | Secret Manager (Cloud Run `--set-secrets`) |
| ANTHROPIC_API_KEY | 높음 | Secret Manager (Cloud Run env, 환경별 분리) |
| OPENAI_API_KEY | 높음 | Secret Manager (Cloud Run env, 임베딩용) |
| JWT_SECRET | 높음 | Secret Manager (환경별 별도 값) |
| POLAR_ACCESS_TOKEN | 높음 | Secret Manager (Cloud Run env, org 단일) |
| POLAR_WEBHOOK_SECRET | 높음 | **환경별 별도** (endpoint별 고유) |
| POLAR_PRODUCT_BASIC/POPULAR/BEST | 중간 | Polar product UUID |
| RECAPTCHA_SECRET_KEY | 중간 | 서버 전용 검증 키 |
| CORS_ORIGIN | 중간 | 환경별 설정 |

- `.env` 파일은 `.gitignore`에 포함 (절대 커밋 금지)
- `.env.example`만 커밋 (실제 값 미포함)
- **실측 검증 (2026-04-17)**: git history 양 레포 grep, 소스 하드코딩, `.env.example` 커밋 전부 확인 → 외부 노출 0건
- 상세 관리: `ACCOUNTS.md` (로컬 전용, git 미추적)

> 환경변수 전체 목록: `docs/environments.md` 참조.

---

## 2. API 보안

### CORS
- localhost: `http://localhost:3001`
- development: `https://dev.grimoire-book.com` (현재 `*` 설정 — 의도된 느슨한 dev 값)
- production: `https://grimoire-book.com`
- `*` 사용 절대 금지 (폴백 제거, 미설정 시 기동 실패) — 단 dev는 의도적 예외

### 입력 검증
- 모든 엔드포인트: `ValidationPipe` (whitelist + forbidNonWhitelisted + transform)
- DTO 기반 검증: `class-validator` 데코레이터
- **실측 (2026-04-17)**: DTO 5개 중 4개 class-validator 적용. 미적용 1개는 `authenticated-request.ts` = 타입 정의 (DTO 아님)

### 인증

#### JWT + Refresh Token (2026-04-12 도입)

- **Access Token**: `grimoire_token`, JWT, 15분 만료, HttpOnly Cookie
- **Refresh Token**: `grimoire_refresh`, opaque token, 7일 만료, HttpOnly Cookie, DB 저장
- 이메일/비밀번호 회원가입 + 로그인 (bcryptjs 해싱)
- Google OAuth 로그인 (`POST /api/auth/google`)
- `passwordHash` 필드는 API 응답에서 제외
- `POST /api/auth/refresh` — Refresh Token으로 새 Access Token 발급

#### 쿠키 속성 (전 엔드포인트 일관)

`src/adapter/inbound/http/controller/auth.controller.ts::cookieOptions()`:
```ts
{
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge,
}
```

- admin.controller도 동일 값으로 통일 (2026-04-16 `lax`→`strict` 수정)
- 예외: `grimoire_anon` (익명 좋아요 쿠키) — `sameSite: 'lax'` (크로스 사이트 좋아요 허용 정책)

#### 가드 커버리지 (2026-04-17 실측)

- **63개 mutation 엔드포인트** 중 54개 보호 (JwtAuthGuard/AdminGuard/OptionalAuthGuard)
- 9개 의도적 공개: `login/register/google/refresh/logout` (인증 전) + `likes/comments/delete-comment` (익명 허용 정책)
- **Admin 40개 엔드포인트** 중 39개 AdminGuard 적용 (나머지 1개는 admin login, 정상)

### Rate Limiting

- `ThrottlerGuard` **APP_GUARD 전역 적용** (`app.module.ts:141`)
- `ThrottlerModule.forRoot([{ ttl: ..., limit: ... }])` 설정
- 모든 엔드포인트 자동 보호 — 개별 `@Throttle` 데코레이터 불필요
- 개별 제한이 필요한 엔드포인트에는 `@Throttle` 오버라이드 가능

### 보안 헤더 (helmet + next.config.ts 통일, 2026-04-17 실측)

**운영 curl 실측 — 전 엔드포인트 동일 헤더:**

| 헤더 | 값 | 효과 |
|------|-----|------|
| Content-Security-Policy | 웹: 전체 CSP / API: `default-src 'self'; script-src 'none'` | XSS/인젝션 차단 |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` | HTTP 폴백 차단 |
| X-Frame-Options | `DENY` | 클릭재킹 차단 |
| X-Content-Type-Options | `nosniff` | MIME sniffing 차단 |
| Referrer-Policy | `strict-origin-when-cross-origin` | 리퍼러 누출 차단 |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` | 센서 API 차단 |

---

## 3. 데이터 보안

### 소유권 검증

- **실측 (2026-04-17)**: application 레이어에 `ForbiddenException/UnauthorizedException` **110건 throw**
- UseCase 내에서 `user.sub` vs 리소스의 `authorId` 비교 후 일치하지 않으면 예외
- 자기 리소스만 수정/삭제 가능 (theme, work, episode 등)

### 크레딧 시스템 (크레딧 개편 CC-1~5 + CC-4 Phase 3 반영)

> 디노미네이션 1:1,000 pt + 포인트 출처 4종 분리 회계(1-C 하이브리드). 정본: ADR-012 / `docs/data-model.md` / `.claude/shared-contracts.md §30`.

- **원장 정본 = `credit_ledgers`**: 적립/차감 전부 입출금 원장 row 박제 (`source`/`type`/`balanceAfter`/`expiresAt`/`relatedId`). `authors.points_*` 4 필드(`points_free`/`points_subscription`/`points_gift`/`points_charged`) + `deficit_points`는 **빠른 조회용 잔액 캐시**.
- **구 `credit_logs` 테이블 폐기 (CC-4 Phase 3, 2026-05-21)**: `DROP TABLE IF EXISTS "credit_logs" CASCADE` (마이그레이션 `20260521_author_credits_drop_credit_log_phase3`). 구 INSERT-only 감사 로그 → 신 `CreditLedger` 원장으로 대체. 회계/감사 영구 보존은 원장 row 불변 정책으로 유지(별도 archive 테이블 `credit_logs_archive_pay_p3_e` 1 row, dev 영역).
- **구 `Author.credits` Int 컬럼 폐기 (CC-4 Phase 3)**: `ALTER TABLE "authors" DROP COLUMN "credits"`. 응답 키 `credits`(`/auth/me` 등)는 controller 측에서 `CreditLedgerPort.getBalance().total` 매핑으로 보존(案 P3-Y 옵션 A — web 영향 0).
- 크레딧 차감/적립: Prisma `$transaction`으로 원자적 처리 (캐시 + 원장 동시 갱신)
- 잔액 음수 방지: 4 출처 차감 + 채팅 사후 차감 시 잔액 부족분은 `deficit_points` 외상으로 박제(상한 -10,000pt), 다음 충전 시 우선 상계

### 결제 원자성 (Atomicity) — 절대 원칙

> **금융 트랜잭션의 핵심: 전부 성공하거나, 전부 실패하거나. 중간 상태는 존재하지 않는다.**

충전 결제 webhook(`order.paid`) 처리 시 아래 작업을 **단일 Prisma `$transaction`**(`completePaymentWithPoints`, CC-2a)으로 묶는다:

1. Payment 상태 → `completed` 변경
2. **deficit 우선 상계** — `authors.deficit_points` 잔액이 있으면 충전분에서 먼저 차감 (구 시스템 영구 외상 자동 해소)
3. `credit_ledgers` charged earn row 박제 (`source='charged'`, `type='earn'`)
4. `authors.points_charged` / `deficit_points` 잔액 캐시 갱신

**왜 반드시 원자적이어야 하는가:**
- Payment만 completed 되고 포인트가 안 들어가면 → 사용자가 돈만 낸 상황
- 포인트만 들어가고 Payment가 pending이면 → 웹훅 재시도 시 포인트 중복 부여
- 어느 한쪽이라도 실패하면 전체 롤백 → 재시도 가능한 안전한 상태 유지

환불 webhook(`order.refunded`)은 대칭 트랜잭션 `refundPaymentWithPoints`(CC-2b): 4 출처(charged→gift→subscription→free) 비례 환수 + 이중 외상 통합 + 다중 부분환불 누적 한도 검증(PAY-S2) + `$executeRawUnsafe` CAS race 차단(PAY-P3-A).

**관련 코드:**
- `src/application/payment/payment.usecase.ts` — `processWebhook()` (라우팅 + 멱등성 게이트)
- `src/adapter/outbound/persistence/prisma-payment.repository.ts` — `completePaymentWithPoints()` / `refundPaymentWithPoints()`
- `src/application/credit/charge-points.usecase.ts` / `grant-points.usecase.ts` — 비결제 적립/차감
- `src/application/payment/payment.usecase.spec.ts` / `payment-charge-credit-integration.spec.ts` — 원자성 검증 테스트

> **구 경로 폐기 박제**: `prisma-credit.repository.ts`(파일 삭제) + `adjustCredits()` + `completePaymentAtomically()` / `refundPaymentAtomically()`는 CC-4에서 완전 제거. 현재 코드 본문 호출 0건(주석/박제 이력만).

### 결제 보안 (Polar, 2026-04-09 PAYAPP 폐기)

- **Polar 웹훅**: Standard Webhooks 스펙 HMAC 서명 검증 (`src/adapter/outbound/payment/polar.adapter.ts::verifyAndParseWebhook`)
- 2환경 webhook endpoint 분리: dev/prod 각자 고유 `POLAR_WEBHOOK_SECRET` (2026-04-19 inhouse endpoint 제거)
- 중복 웹훅 방지: `tradeNo(checkoutId)` 기반 멱등성 (이미 completed면 무시)
- 결제 기록: Payment 테이블에 전부 기록 (감사 추적)
- 결제 시작 → 완료 사이: pending 상태로 추적
- 서명 검증 실패 시: 즉시 null 반환 + 로그 기록

### Polar SDK timeout 정책 (PAY-P3-B, 2026-05-09)

- **워커 자원 leak 차단**: `new Polar({ timeoutMs })` Polar SDK v0.47.0 SDKOptions.timeoutMs 내장 옵션 (옵션 A 채택). env `POLAR_SDK_TIMEOUT_MS` 오버라이드 (기본값 30000ms).
- **exception 5분류 + 분기 처리**: `classifyPolarError(e)` (timeout/network/server_5xx/client_4xx/unknown). client_4xx (HTTP 400/401/403/404/422) 즉시 `webhook_permanent_failed` 박제 + retry queue 박제 0건 (요청 결함은 retry 무의미). 외 4분류 → 기존 PAY-P2-2 DLQ 흐름 유지.
- **AuditLog 박제**: 4xx 즉시 permanent → `operator='system_dlq' action='webhook_permanent_failed'` (PAY-P3-B 신설). detail에 `{ reason: 'polar_4xx_no_retry', errorClass, httpStatus, paymentId, branch, originalMessage }` 박제 → 운영 추적 가능.
- 정본: `.claude/shared-contracts.md §24 PolarSDKTimeoutPolicy`

### 재가입 방지
- signup_history: OAuth provider ID로 추적
- 재가입 시 보너스 크레딧 미지급

---

## 4. 배포 전 체크리스트

### 서버

- [ ] `npm test` 전부 통과
- [ ] `npm run build` 성공
- [ ] `docker build` 성공
- [ ] 환경변수 설정 확인 (DATABASE_URL, ANTHROPIC_API_KEY, JWT_SECRET, POLAR_*)
- [ ] Prisma 마이그레이션 완료
- [ ] API 엔드포인트 응답 확인
- [ ] CORS 설정 확인 (`*` 아닌지)
- [ ] Swagger: production에서 비활성화 (2026-04-12 @nestjs/swagger 제거 완료)
- [ ] DB 방화벽 규칙 확인
- [ ] auth guard 적용 확인 (모든 mutation 엔드포인트에 @UseGuards(JwtAuthGuard))
- [ ] role 기반 접근 제어 (admin 엔드포인트에 AdminGuard)
- [ ] 소유권 검증 (자신의 리소스만 수정/삭제 가능)
- [ ] 입력값 검증 (DTO에 class-validator 적용)
- [ ] 토큰 저장 방식 (HttpOnly Cookie, localStorage 사용 금지)
- [ ] 환경변수에 placeholder/기본값 없는지 확인
- [ ] Rate limiting (APP_GUARD `ThrottlerGuard` 전역 적용 확인)

### CC-5 구독 정기결제 엔드포인트 (PAY-P1-4, 2026-05-22)

- [x] `POST /subscriptions/checkout` — `@UseGuards(JwtAuthGuard)` + `@Throttle`(분당 3) 적용. 소유권 = body 에 authorId 미수신, `req.user.sub` 사용(위조 불가)
- [x] `GET /membership` — `@UseGuards(JwtAuthGuard)` 적용. 응답에 내부 ID(`authorId`/`polarSubscriptionId`/`id`) 미노출
- [x] DTO `StartSubscriptionDto` class-validator 적용 (`@IsIn(['pro','premium'])` + `@IsUrl`)
- [x] graceful — env(`POLAR_PRODUCT_SUBSCRIPTION_*`) 미설정 시 `503` (시크릿/내부 상태 미노출 메시지)
- [x] 구독 webhook — `WebhookEvent` 멱등성 게이트 재사용 (중복 `changeTier` 차단)

### 자동화 — sensor-security-gate.sh (신설, 2026-04-17)

QA 에이전트가 매일 23:21에 아래 8항목을 자동 실행하여 CRITICAL 감지 시 배포 차단:

1. Mutation 엔드포인트 중 가드 미적용 (Public 제외) 검사
2. Admin 엔드포인트 AdminGuard 누락 검사
3. 쿠키 sameSite='strict' 일관성 검사
4. 웹 localStorage에 token/password/jwt/secret 저장 여부
5. 'use client' 파일에서 외부 API 직접 fetch 여부
6. 운영 보호 엔드포인트 토큰 없이 401 반환 여부 (curl 실측)
7. 보안 헤더 6종 curl 응답 일관성
8. dangerouslySetInnerHTML 사용 여부

스크립트: `.claude/scripts/sensor-security-gate.sh`
사용법: QA 에이전트가 `sensor-server.sh`/`sensor-web.sh`와 동일 패턴으로 raw stdout을 QA_REPORT.md에 전체 첨부.

### 공통

- [ ] 2개 레포 CHANGELOG.md 업데이트
- [ ] 2개 레포 TODO.md 업데이트
- [ ] `docs/` 파일 2개 레포 동기화 확인

### 수동 배포 시 보안 체크 (2026-04-18 신설)

> GitHub Actions 빌링 이슈 등으로 CI가 막혔을 때 1차 배포 수단이 `make deploy-{env}`가 된다. 관련 정본은 `docs/DEPLOY.md`.
> **2026-06-10 GCP 전환 완료**: 배포 경로가 Azure(`az account/acr/containerapp`)에서 GCP(`gcloud auth/Artifact Registry/Cloud Run/Cloud SQL`)로 재작성됨. Azure decommission(2026-06-04)으로 구 Azure 절차는 실행 불가.

배포 스크립트(`scripts/deploy-*.sh`)는 `scripts/preflight.sh`를 **반드시 선행 호출**하고, 아래 보안 관련 항목을 자동 검증(8 step)한다. 하나라도 실패하면 배포 중단. **모든 gcloud 측정은 `--project grimoire-491708 --region asia-northeast1` 명시 강제** (로컬 gcloud 전역 default가 `pr-letter-addr`/ne3일 수 있어 무지정 측정은 거짓 PASS/FAIL 유발).

- [x] gcloud 활성 계정 존재 + 기대 계정(`rainmaker8492@gmail.com`) 일치 검증 (불일치 시 warn — 배포는 `--project` 명시로 안전 진행)
- [x] 프로젝트 `grimoire-491708`(project number `23295981916`) 접근 가능 — `--project` 명시로 직접 확인 (전역 default 무관)
- [x] Artifact Registry repo `grimoire-docker`(asia-northeast1) 존재 검증
- [x] Cloud Run 서비스 FQDN(`*.run.app`)이 매트릭스와 일치 — 오타/잘못된 서비스 갱신 방지
- [x] Cloud SQL 인스턴스 `grimoire-db-{env}` state=RUNNABLE 검증
- [x] 필수 환경변수/Secret 바인딩(DATABASE_URL/JWT_SECRET/CORS_ORIGIN/APP_ENV/POLAR_ACCESS_TOKEN/POLAR_WEBHOOK_SECRET/ANTHROPIC_API_KEY/OPENAI_API_KEY) 존재 — Cloud Run revision의 plain name + secretRef name 모두 검사, 값은 출력하지 않고 키만 검증 (`AZURE_STORAGE_*`는 GCS 전환으로 제거됨)
- [x] CORS 환경별 기대값 검증 — dev=`*` 경고, prod는 엄격 도메인 매칭
- [x] git 워킹 트리 클린 + origin/<브랜치> 와 완전 동기화 — 로컬 미커밋/미푸시 상태로 배포하여 재현 불능 이미지 방지
- [x] 이미지 태그 `{env}-{SHA}` 강제 — `:latest` 태그 노출 금지, 롤백 시 SHA로 역추적 가능
- [x] prod 배포 시 interactive `yes` 입력 요구 — 실수 방지 (비대화형 환경에선 `SKIP_INTERACTIVE=1` 명시 필요)

**수동 배포 시 비밀값 유출 주의사항**:

1. 스크립트 stdout에 환경변수 **값**을 출력하지 않는다 (preflight는 "설정됨/누락" 여부만 출력).
2. `docker build` 시 `--build-arg`로 전달되는 값은 이미지 레이어에 남는다. 현재 web 빌드의 `NEXT_PUBLIC_*` 3개는 **공개 값 전용** (공개 recaptcha site key, Google OAuth client ID). 비밀값을 build-arg로 넘기지 말 것.
3. Docker 이미지에는 `.env` 파일을 포함하지 않는다. Dockerfile의 `.dockerignore`에 `.env` 포함 여부 확인.
4. Artifact Registry 푸시 자격증명은 `gcloud auth configure-docker asia-northeast1-docker.pkg.dev`(credHelper, keychain)이 관리하고 stdout에 노출하지 않는다. 비밀값 단일 진실은 **Secret Manager** (Cloud Run `--update-secrets` 바인딩).

---

## 5. 네트워크/포트 보안 현황

> 설정값 자체는 `INFRASTRUCTURE.md` §9 참조. 여기는 **왜 안전한지, 공격 시나리오별 방어**를 기록한다.

### 외부 노출 포트

| 레이어 | 열린 포트 | 비고 |
|--------|----------|------|
| Cloudflare (최외곽) | 443 (HTTPS) | DDoS 방어 + CDN + 실제 origin IP 은닉 |
| Cloud Run | 443만 (Google Frontend) | 컨테이너 내부 포트는 인터넷 노출 안 됨 |
| Cloud SQL | 5432 | Auth Proxy(Unix socket) 강제, Public IP allowlist 폐기 (메인 IP `/32`만 잔존) |
| Artifact Registry | 443 (IAM 인증) | pull/push에 GCP IAM(SA) 필수 |

> 인터넷에서 포트 스캔 시 Cloudflare IP의 443만 보인다.
> Cloud SQL은 Auth Proxy 경유 외 외부 접근 차단 (Public IP allowlist 폐기).

### 공격 시나리오별 방어

| 공격 | 방어 | 설정 위치 |
|------|------|----------|
| DDoS | Cloudflare Proxy (무료 플랜 자동 방어) | Cloudflare 대시보드 |
| 포트 스캔 | Cloud Run: 443만 노출. DB: Auth Proxy 외 차단 | GCP 플랫폼 구조 |
| SQL 인젝션 | Prisma ORM 파라미터 바인딩. raw SQL 미사용 | 코드 레벨 |
| Brute force 로그인 | Throttler 전역 + 로그인에 reCAPTCHA v3 | `auth.controller.ts` + `recaptcha.service.ts` |
| API 남용 | 전 엔드포인트 Throttle (APP_GUARD) | `app.module.ts:141` |
| CORS 우회 | 환경별 도메인 1개만 허용 (`*` 금지) | `main.ts` enableCors |
| DB 직접 접근 | Cloud SQL Auth Proxy(IAM) 강제. Public IP allowlist 폐기, 메인 IP `/32`만 잔존 | Cloud SQL Auth Proxy |
| XSS | CSP(`script-src 'self'`) + HttpOnly Cookie + `dangerouslySetInnerHTML` 0건 | helmet + next.config.ts |
| CSRF | SameSite=Strict + CORS 단일 origin (CSRF 토큰은 TODO) | cookieOptions |
| 클릭재킹 | X-Frame-Options: DENY | helmet + next.config.ts |
| 중간자(MITM) | HSTS 2년 + preload + Secure Cookie | helmet + next.config.ts |
| 세션 탈취 (XSS) | HttpOnly (JS 접근 불가) + Access 15분 단기 | cookieOptions |
| 에피소드 크롤링 | 에피소드 상태값(nonPublic) + Throttler + Cloudflare Bot | `content.controller.ts` + DB |
| 내부 필드 노출 | API 응답에서 rawMd, workId, authorId 제거 완료 | `content.controller.ts`, `theme.controller.ts` |
| 이미지 저장소 탈취 | Artifact Registry IAM 인증 필수 (SA) | GCP Artifact Registry |
| 결제 웹훅 위조 | HMAC 서명 검증 + tradeNo 멱등성 | `polar.adapter.ts` |
| BFF 우회 | Next.js `/api/[...path]/route.ts` + 서버에서 CORS 차단 | BFF 프록시 |

### DB 접근 운영 규칙 (Cloud SQL Auth Proxy)

- 평상시: Public IP allowlist 폐기 — Cloud SQL Auth Proxy(IAM 인증) 경유만. 메인 IP `221.150.30.109/32`만 allowlist 잔존(수동 운영용).
- 로컬 DB 직접 접속 필요 시: Auth Proxy spawn → 작업 완료 → kill (또는 임시 IP allowlist 추가 후 즉시 제거)
- allowlist/Auth Proxy 운영 변경 시 INFRASTRUCTURE.md §9 업데이트

### 비용 폭탄 방지 (보안 관점)

| 설정 | 값 | 효과 |
|------|-----|------|
| maxReplicas | 1 (전 환경) | 자동 확장으로 인한 과금 폭증 불가 |
| autoGrow | Disabled (전 DB) | 스토리지 자동 확장 없음 |
| 예산 알림 | $100/월 (50%/80%/100% 알림) | 비정상 과금 감지 |
| ACR 이미지 정리 | 배포 시 자동 정리 (환경별 최근 5개 유지) | 저장 비용 제한 |

---

## 6. 보안 강화 TODO

> 2026-04-17 전수 감사 결과 기반. 오늘 기준 실제 취약점 없음. 아래는 개선 여지.

### 중기 (설계적 개선)

| 항목 | 현재 | 조치 | 우선순위 |
|------|------|------|---------|
| **CSRF 토큰** | SameSite=Strict + CORS 단일 origin으로 부분 방어 | Double-submit cookie 패턴 또는 `csurf` 미들웨어 도입 | 중간 |
| **BFF 프록시 화이트리스트** | `[...path]` catch-all — `/api/admin/*`도 프록시 통과 | `/api/admin/*` 경로 화이트리스트 도입 또는 블랙리스트 | 중간 |
| **@Public 데코레이터 명시** | 의도 공개 9개 + 가드 없음 상태가 구분 불명 | `@Public()` 커스텀 데코레이터로 의도 표시 | 낮음 (readability) |
| **admin.controller 쿠키 통일** | `cookieOptions()` 재사용 안 하고 인라인 | auth.controller의 `cookieOptions()` import 공용 | 낮음 |
| **ANTHROPIC_API_KEY 환경 분리** | 2환경 공유 (dev/prod) | prod 전용 키 별도 발급 → dev 키 유출 영향 차단 | 낮음 |

### 결제/티어 도입 시

| 항목 | 설명 |
|------|------|
| 구독 티어 서버 사이드 검증 | 클라이언트가 보내는 요청을 DB 기반 티어로 교차 검증. 권한 밖 요청 403 차단 |
| AI 모델 접근 제어 | 티어별 사용 가능 모델 제한 (현재는 서버가 모델을 결정하므로 공격 벡터 없음) |

### 트래픽 증가 시

| 항목 | 설명 |
|------|------|
| Rate Limiting IP 기반 강화 | 현재 단순 Throttle → 프록시 뒤 IP 식별 (X-Forwarded-For) 추가 |
| 크레딧 동시성 | optimistic locking 적용 (동시 좋아요/크레딧 차감 경합 방지) |
| WAF | Cloudflare WAF 유료 플랜 또는 GCP Cloud Armor 검토 |

### 이미 적용된 항목 (2026-04-17 실측 확인)

| 항목 | 상태 | 증거 |
|------|------|------|
| HttpOnly + Secure + SameSite=Strict Cookie | ✅ | `cookieOptions()` + admin.controller 통일 |
| LocalStorage 토큰 저장 금지 | ✅ | 웹 전수 grep: token/password/jwt 0건 |
| BFF 프록시 패턴 | ✅ | 클라이언트 컴포넌트 외부 fetch 0건 |
| JwtAuthGuard 전 mutation 적용 | ✅ | 63개 중 54개 보호 + 9개 의도 공개 |
| AdminGuard 관리자 엔드포인트 | ✅ | 40개 중 39개 (나머지 1개는 admin login) |
| 소유권 검증 | ✅ | application 레이어 ForbiddenException 110건 |
| ValidationPipe + class-validator | ✅ | DTO 4/5 (나머지 1개는 타입 정의) |
| NEXT_PUBLIC_ 최소화 | ✅ | API URL 클라이언트 미노출 |
| Cloudflare DDoS 방어 + Proxy | ✅ | Cloudflare 무료 플랜 |
| Rate Limiting 전 엔드포인트 | ✅ | ThrottlerGuard APP_GUARD |
| DB 접근 Cloud SQL Auth Proxy 강제 | ✅ | Public IP allowlist 폐기, 메인 IP `/32`만 잔존 |
| helmet (HTTP 헤더) | ✅ | main.ts `app.use(helmet({...}))` — 2026-04-16 커스터마이징 |
| CSP 헤더 (서버 + 웹) | ✅ | helmet CSP + next.config.ts CSP |
| HSTS 2년 + preload | ✅ | `max-age=63072000; includeSubDomains; preload` |
| X-Frame-Options: DENY | ✅ | helmet + next.config.ts |
| reCAPTCHA v3 (register/login) | ✅ | `recaptcha.service.ts` + 서버 검증 |
| honeypot 필드 (비로그인 댓글) | ✅ | 2026-04-02 적용 |
| robots.txt | ✅ | /api/, /dashboard/, /admin/ disallow |
| Refresh Token (Access 15분 + Refresh 7일) | ✅ | 2026-04-12 도입 |
| ExceptionFilter (prod 스택 숨김) | ✅ | 2026-04-12 적용 |
| npm audit 0건 | ✅ | 2026-04-12 NestJS 11 + Next.js latest 업그레이드 |
| Source Map 프로덕션 비활성화 | ✅ | `next.config.ts` productionBrowserSourceMaps: false |
| Polar 웹훅 서명 검증 | ✅ | Standard Webhooks HMAC |
| 결제 원자성 (단일 $transaction) | ✅ | payment.usecase.spec.ts 검증 |
| 결제 환경별 webhook secret 분리 | ✅ | 3환경 각자 다른 POLAR_WEBHOOK_SECRET |

---

## 7. 참조 문서

- `INFRASTRUCTURE.md` — GCP 인프라 구성 (Cloud Run + Cloud SQL + Artifact Registry + GCS)
- `docs/environments.md` — 환경별 설정 (정본)
- 루트 `CLAUDE.md` §11 — 전수검사 체크리스트
- `.claude/scripts/sensor-security-gate.sh` — 자동화 보안 게이트
- 루트 `research/RESEARCH_HANLINE_API.md` — 경쟁사 한줄 API/보안 분석 (git 미추적)

---

## 8. 감사 이력

| 일자 | 감사 범위 | 결과 |
|------|----------|------|
| 2026-03-31 | 초기 보안 감사 + 경쟁사 한줄 분석 | TODO 로드맵 수립 |
| 2026-04-02 | helmet + reCAPTCHA + honeypot + robots.txt | 봇/크롤러 방어 1차 완료 |
| 2026-04-12 #3 | NestJS 11 + Refresh Token + 보안 헤더 + npm audit | audit 양쪽 0건 |
| 2026-04-16 | admin SameSite 통일 + helmet CSP 커스터마이징 + Next.js CSP | 보안 헤더 서버/웹 일관성 |
| **2026-04-17** | **16항목 전수 실측 (grep + curl)** | **실제 취약점 0건, 개선 여지 5건 TODO 편입** |
