# SCHEMA.md — grimoire-server

> Prisma 스키마 구현 상세.
> 정본은 `prisma/schema.prisma` — 이 문서는 읽기 편한 설명 버전이다.
> 공유 스키마 문서: `docs/data-model.md`

---

## 1. 스키마 위치

- `prisma/schema.prisma`
- Provider: PostgreSQL
- Binary targets: `native`, `linux-musl-arm64-openssl-3.0.x`, `linux-musl-openssl-3.0.x`

---

## 2. 모델 상세

> 아래 내용은 `prisma/schema.prisma`에서 파생된다. 스키마가 변경되면 이 문서도 업데이트한다.

### authors

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK, default(uuid()) | 작가 고유 식별자 |
| slug | slug | String | unique | URL 경로 (`/{slug}/`) |
| name | name | String | - | 작가명 |
| email | email | String | unique | 이메일 |
| passwordHash | password_hash | String? | - | 비밀번호 해시 (bcryptjs) |
| credits | credits | Int | default(0) | **[DEPRECATED — 크레딧 개편 I Phase]** points_* 4 필드로 이행. 1 sprint 유예 후 DROP |
| pointsFree | points_free | Int | default(0) | **크레딧 개편 I Phase** — 무료 적립 포인트 잔액 캐시 (CAC) |
| pointsSubscription | points_subscription | Int | default(0) | **크레딧 개편 I Phase** — 구독 월 풀 포인트 잔액 캐시 (이월 금지) |
| pointsGift | points_gift | Int | default(0) | **크레딧 개편 I Phase** — 응원 선물 수령 포인트 잔액 캐시 |
| pointsCharged | points_charged | Int | default(0) | **크레딧 개편 I Phase** — 충전 포인트 잔액 캐시 (영구 보존) |
| deficitPoints | deficit_points | Int | default(0) | **크레딧 개편 I Phase** — 외상 (채팅 사후 차감 부족분, 충전 시 우선 상계) |
| plan | plan | String | default("free") | **[DEPRECATED — CC-5, ADR-015 案 B]** tier 정본이 `MembershipPlan.tier` 로 이행. application 직접 읽기 0건(`MembershipPlanPort.getPlan` 경유). `changeTier` 案 A 미러로 동기 갱신 — 컬럼 물리 DROP 전까지 stale 방지용. 컬럼 DROP 은 별도 후속 sprint |
| planExpireAt | plan_expire_at | DateTime? | - | **[DEPRECATED — CC-5, ADR-015]** 만기 판정은 `MembershipPlan.status`/`expiresAt` 정본. `changeTier` 案 A 미러 — `MembershipPlan.poolResetAt` 미러 (free → null / pro·premium → 다음 풀 리셋일) |
| theme | - | Theme? | 1:1 관계 | 작가 테마 |
| works | - | Work[] | 1:N 관계 | 작품 목록 |
| socialAccounts | - | SocialAccount[] | 1:N 관계 | 소셜 로그인 계정 |
| creditLedgers | - | CreditLedger[] | 1:N 관계 (Restrict) | **크레딧 개편 I Phase** — 포인트 입출금 원장 |
| membershipPlans | - | MembershipPlan[] | 1:N 관계 (Restrict) | **크레딧 개편 I Phase** — 멤버십 등급 + 월 풀 |
| createdAt | created_at | DateTime | default(now()) | 가입일 |

> **크레딧 개편 I Phase (2026-05-17)**: 디노미네이션 1:1,000 — `credits` 단일 Int → `points_*` 4 필드(출처별 잔액 캐시, 1-C 하이브리드) + `credit_ledgers` 원장. 정본 ADR-012.
>
> **크레딧 개편 CC-3 (2026-05-20, ADR-014)** — 이월 금지 lazy 안전망 + Author.plan 양측 동기 + 신 ledger 선물 랭킹. ① `MembershipPlanPort.checkAndResetExpiredPool` 신설 — `credit.usecase.getPointBalance` 진입에서 lazy 자동 보정(cron 1차 + lazy 2차 이중 안전망, §8-8 #2 이월 금지 코드 강제). ② `changeTier` 트랜잭션에 `Author.plan`/`planExpireAt` 동기 갱신 (案 A 양측 정합). ③ `CreditLedgerPort.getGiftRanking` 신설 — `credit.usecase.getGiftRanking`/`getLogs` 가 ledger 위임 (구 `CreditLog` 신·구 분열 해소).
>
> **크레딧 개편 CC-5 (2026-05-22, ADR-015)** — Polar 구독 정기결제 연동 + HIGH-1 案 B. ① **案 B 전환** — tier 정본을 `MembershipPlan.tier` 로 이행, `Author.plan`/`planExpireAt` `[DEPRECATED]`(`changeTier` 案 A 미러 유지 — 컬럼 물리 변경 0건, DROP 은 별도 후속). ② `MembershipPlan.polarSubscriptionId` 는 I Phase 부터 존재한 필드 — CC-5 에서 `changeTier(_, _, _, polarSubscriptionId)` 가 구독 webhook 매핑 저장에 사용(스키마 변경 0건). ③ `changeTier` 가 구독 상태를 `status`/`expiresAt` 에 반영 — free 다운그레이드 → `status='cancelled'`+`expiresAt=now` / pro·premium → `status='active'`. **마이그레이션 0건** (案 B = deprecated 주석만, 필드 추가 0).

### themes

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 테마 식별자 |
| author | - | Author? | 관계 | 작가 참조 (null이면 시스템 테마) |
| authorId | author_id | String? | FK→authors, nullable | 작가. null = 시스템 테마 |
| preset | preset | String | default("midnight") | 프리셋명 (파생 출처 기록용) |
| overrides | overrides | Json? | - | AuthorTheme 전체 값 (`docs/theme-spec.md` 참조) |
| rawDescription | raw_description | String? | - | 작가 원본 구술 텍스트 |
| bakedCssUrl | baked_css_url | String? | - | Baking된 CSS 파일 URL. **항상 절대 URL(Blob CDN) OR NULL**. NULL이면 응답 시점에 server가 `PUBLIC_API_BASE_URL`로 동적 절대화 (P1-#7, 2026-05-03). 상대 경로(`/api/themes/css/...`) 박제 금지 — 환경 전환 stale 방지 |
| isSlotted | is_slotted | Boolean | default(true) | 활성 슬롯 배치 여부 |
| source | source | String | default("user") | 테마 출처 (system/ai/user) |
| updatedAt | updated_at | DateTime | @updatedAt | 수정일 |

### works

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 작품 식별자 |
| author | - | Author | 관계 | 작가 참조 |
| authorId | author_id | String | FK→authors | 작가 |
| slug | slug | String | @@unique([authorId, slug]) | URL 경로 |
| title | title | String | - | 작품 제목 |
| subtitle | subtitle | String? | - | 부제 |
| description | description | String? | - | 설명 |
| context | context | String? | - | 작품 맥락/프로젝트 메모리 (AI 채팅 시 주입) |
| instructions | instructions | String? | - | 작품 지침 (문체 규칙, 톤 — AI 채팅 시 주입) |
| viewCount | view_count | Int | default(0) | 조회수 |
| episodes | - | Episode[] | 1:N 관계 | 에피소드 목록 |
| createdAt | created_at | DateTime | default(now()) | 생성일 |

### episodes

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 에피소드 식별자 |
| work | - | Work | 관계 | 작품 참조 |
| workId | work_id | String | FK→works | 작품 |
| slug | slug | String | @@unique([workId, slug]) | URL 경로 |
| title | title | String | - | 제목 |
| subtitle | subtitle | String? | - | 부제 |
| description | description | String? | - | 에피소드 설명 |
| type | type | String | default("episode") | 에피소드 유형 (episode/preface/afterword/bonus) |
| orderNum | order_num | Int | - | 순서 |
| blocks | blocks | Json | - | 파싱된 Block[] (`docs/glossary.md` Block 타입 참조) |
| rawMd | raw_md | String | - | 원본 마크다운 |
| viewCount | view_count | Int | default(0) | 조회수 |
| sourceFormat | source_format | String | default("markdown") | 원고 포맷 (markdown/txt/docx) |
| status | status | String | default("upload") | 상태 (upload/public/nonPublic/shared) |
| isIndexed | is_indexed | Boolean | default(false) | RAG 벡터 인덱싱 완료 여부 |
| sharedToken | shared_token | String? | @unique | 공유 링크 토큰 |
| sharedExpireAt | shared_expire_at | DateTime? | - | 공유 링크 만료 시각 |
| createdAt | created_at | DateTime | default(now()) | 생성일 |

### credit_logs

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 로그 식별자 |
| authorId | author_id | String | - | 작가 ID (FK 없음 — 감사 로그 특성) |
| amount | amount | Int | - | 양수: 적립, 음수: 차감 |
| reason | reason | String | - | 변동 사유 (`docs/glossary.md` 크레딧 사유 코드 참조) |
| createdAt | created_at | DateTime | default(now()) | 기록일 |

### social_accounts

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 식별자 |
| author | - | Author | 관계 | 작가 참조 |
| authorId | author_id | String | FK→authors | 작가 |
| provider | provider | String | @@unique([provider, providerId]) | OAuth 제공자 (google 등) |
| providerId | provider_id | String | @@unique([provider, providerId]) | 제공자별 고유 ID |
| providerEmail | provider_email | String? | - | 제공자 이메일 |
| createdAt | created_at | DateTime | default(now()) | 연동일 |

### signup_history

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| providerId | provider_id | String | PK | OAuth provider ID |
| firstSignupAt | first_signup_at | DateTime | default(now()) | 최초 가입일 |
| signupCount | signup_count | Int | default(1) | 가입 횟수 |

### bookmarks

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 식별자 |
| authorId | author_id | String | @@unique([authorId, episodeId]) | 독자(작가) ID |
| episodeId | episode_id | String | @@unique([authorId, episodeId]) | 에피소드 ID |
| createdAt | created_at | DateTime | default(now()) | 북마크 생성일 |

### reading_progress

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 식별자 |
| authorId | author_id | String | @@unique([authorId, episodeId]) | 독자(작가) ID |
| episodeId | episode_id | String | @@unique([authorId, episodeId]) | 에피소드 ID |
| blockIndex | block_index | Int | - | 마지막으로 읽은 블록 인덱스 |
| updatedAt | updated_at | DateTime | @updatedAt | 갱신일 |

### likes

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 식별자 |
| authorId | author_id | String? | @@unique([authorId, episodeId]) | 독자 ID (null=익명) |
| episodeId | episode_id | String | @@index | 에피소드 ID |
| ipAddress | ip_address | String? | @@index(ip+cookie+episode) | 익명 좋아요 IP |
| cookieId | cookie_id | String? | @@index(ip+cookie+episode) | 익명 브라우저 식별 |
| createdAt | created_at | DateTime | default(now()) | 좋아요 생성일 |

### subscriptions

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 식별자 |
| subscriberId | subscriber_id | String | @@unique([subscriberId, targetAuthorId]) | 구독자 ID |
| targetAuthorId | target_author_id | String | @@unique([subscriberId, targetAuthorId]) | 구독 대상 작가 ID |
| createdAt | created_at | DateTime | default(now()) | 구독일 |

### comments

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 식별자 |
| authorId | author_id | String? | - | 작성자 ID (null=익명) |
| episodeId | episode_id | String | @@index(episode+created) | 에피소드 ID |
| content | content | String | - | 댓글 내용 (1~500자) |
| nickname | nickname | String? | - | 익명 댓글 닉네임 |
| passwordHash | password_hash | String? | - | 익명 댓글 비밀번호 (bcrypt) |
| ipAddress | ip_address | String? | - | 익명 댓글 IP |
| parentId | parent_id | String? | FK→comments, @@index | 부모 댓글 (대댓글용) |
| parent | - | Comment? | 관계 ("CommentReplies") | 부모 참조 |
| replies | - | Comment[] | 관계 ("CommentReplies") | 대댓글 목록 |
| createdAt | created_at | DateTime | default(now()) | 작성일 |

### payments

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 결제 식별자 |
| authorId | author_id | String | - | 결제 작가 ID |
| productId | product_id | String | - | 상품 ID |
| amount | amount | Int | - | 결제 금액 (원) |
| points | points | Int | - | **[CC-4 Phase 2 rename, 2026-05-21]** 충전 총 포인트(pt) — 구 컬럼명 `credits`(CC-2a 의미 재해석 "패키지 수량"→"pt") → `points` 물리 rename 완료. 마이그레이션: `20260521_payment_credits_rename_phase2`. 값 = `CREDIT_PRODUCTS.points` |
| externalTransactionId | external_transaction_id | String? | unique | 외부 결제 거래 번호 |
| status | status | String | default("pending") | 결제 상태 (pending/completed/failed) |
| createdAt | created_at | DateTime | default(now()) | 결제 요청일 |
| completedAt | completed_at | DateTime? | - | 결제 완료일 |

### webhook_events (Sprint PAY-P0-1, 2026-05-03)

PG 웹훅 재전송 멱등성 박제 — `event_id` UNIQUE 제약으로 race condition 차단. 정본: `.claude/shared-contracts.md` §11.

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 박제 식별자 |
| eventId | event_id | String | unique | PG 발급 이벤트 ID (Polar `webhook-id` 헤더) |
| source | source | String | default("polar") | PG 식별 |
| eventType | event_type | String | - | 이벤트 타입 ('order.paid' 등) |
| payload | payload | Json | - | NormalizedWebhookEvent 박제 (디버깅용) |
| status | status | String | default("processed") | 'processed' \| 'skipped' \| 'failed' |
| errorMessage | error_message | String? | - | 실패/스킵 사유 |
| processedAt | processed_at | DateTime | default(now()) | 박제 시각 |

@@index: `[eventType, processedAt]` — 최근 이벤트 조회 성능

### reconciliation_checkpoints (Sprint PAY-P0-2, 2026-05-03)

PG↔DB 정합성 검증 cron의 단일 row checkpoint — `id` default `'singleton'` + INSERT seed로 항상 1 row 보장. 정본: `.claude/shared-contracts.md` §12.

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String | PK, default("singleton") | 단일 row 보장 — 항상 'singleton' |
| lastRunAt | last_run_at | DateTime (Timestamptz(3)) | - | 마지막 cron 시작 시각 (다음 cron의 since 필터) |
| processedCount | processed_count | Int | default(0) | 마지막 실행에서 처리한 row 수 |
| boostCount | boost_count | Int | default(0) | 자동 보정 row 수 (S1) |
| mismatchCount | mismatch_count | Int | default(0) | refund mismatch row 수 (S2) |
| expireCount | expire_count | Int | default(0) | pending 만료 row 수 (S3) |
| errorMessage | error_message | String? | - | 마지막 실행 예외 메시지 (null이면 정상) |
| updatedAt | updated_at | DateTime (Timestamptz(3)) | @updatedAt | 갱신 시각 |

**정책**:
- 단일 row 보장: 마이그레이션 INSERT seed (`id='singleton'`, `last_run_at=NOW()-INTERVAL '24 hours'`, `ON CONFLICT DO NOTHING`)
- 어댑터 fallback: row 미존재 시 default seed 반환 (lastRunAt = 24h 전, 모든 카운터 0)
- update는 항상 upsert (where id='singleton')
- cron 주기: `@Cron('0 */10 * * * *')` 10분 (cost-accountant 권고)

### refund_logs (Sprint PAY-P1-1, 2026-05-03; CC-2b 의미 재해석 2026-05-20; CC-4 Phase 2 보존 2026-05-21)

Polar 환불 webhook 시 크레딧 환수 트랜잭션의 영구 박제. CC-2b 이후 RefundPaymentUseCase 가 `paymentRepo.refundPaymentWithPoints` `$transaction` 내부에서 박제 (4 출처 환수 + 이중 외상 통합). 정본: `.claude/shared-contracts.md` §13 + §30.

**CC-4 Phase 2 컬럼 처리 — 案 Y (보존 + 의미 박제 강화)**: `Payment.credits → Payment.points` 물리 rename 시 RefundLog의 `credits`·`deficit_credits` 컬럼은 **rename하지 않고 보존** (DDL 변경 0건). 사유: (a) 명명 충돌 회피 (`Author.deficitPoints` 외상 잔액 정본) (b) 회귀 범위 최소화 (admin/audit 전용, HTTP 미노출) (c) CC-2b 의미는 schema 주석 강화로 박제.

- `credits` Int — **[CC-2b 재해석 / CC-4 Phase 2 보존]** 실 환수 pt (`actualRefunded`, 4 출처 합). 단위 = `Payment.points`와 일관.
- `deficit_credits` Int — **[CC-2b 재해석 / CC-4 Phase 2 보존]** 이 환불 1건이 유발한 외상 pt 기여분 (감사 추적용). **외상 잔액 정본은 `Author.deficitPoints` 단일화**.

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 환불 로그 식별자 |
| paymentId | payment_id | String | @@index | 환불 대상 Payment id (1:N — 부분 환불 호환 unique 미부여) |
| amount | amount | Int | - | PG 환불 금액 (KRW) |
| credits | credits | Int | - | **실 환수 pt** (CC-2b 의미 재해석 — actualRefunded, 4 출처 합) |
| deficitCredits | deficit_credits | Int | default(0) | **이 환불이 유발한 외상 pt 기여분** (CC-2b 의미 재해석 — 외상 잔액 정본은 Author.deficitPoints) |
| reason | reason | String | - | 환불 사유 (예: 'polar_webhook_order.refunded') |
| processedAt | processed_at | DateTime (Timestamptz(3)) | default(now()) | 환수 처리 시각 |
| source | source | String | - | 'webhook' \| 'manual' |

@@index: `[paymentId]` — Payment별 환불 이력 조회

**정책 (CC-2b 갱신)**:
- **이중 외상 통합**: 잔액 부족분 → `Author.deficitPoints` 가산 + `CreditLedger type='deficit_incur'` (reason=`refund_deficit:..`). 외상 정본 단일화 — 다음 충전 시 CC-2a `completePaymentWithPoints` 가 자동 회수.
- **4 출처 환수**: `REFUND_RECOVERY_ORDER = ['charged','gift','subscription','free']` 우선. 출처별 `CreditLedger type='spend'` row.
- **PAY-P3-A CAS race 차단**: `$executeRawUnsafe UPDATE WHERE 컬럼 >= 환수액` count=0 시 throw CAS_MISMATCH.
- **AdminAuditLog 후행**: `operator='system_refund'`, `action ∈ {refund_normal, refund_partial, refund_deficit, refund_partial_deficit}` (트랜잭션 외)
- 3중 멱등성 보존: L1 `webhook_events.eventId @unique` / L2 payment status 사전 게이트 / L3 refund_logs 박제

### chat_sessions

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 세션 식별자 |
| authorId | author_id | String | @@index([authorId, workId]) | 작가 ID |
| workId | work_id | String | @@index([authorId, workId]) | 작품 ID |
| title | title | String | default("새 대화") | 세션 제목 |
| messages | - | ChatMessage[] | 1:N 관계 | 메시지 목록 |
| createdAt | created_at | DateTime | default(now()) | 생성일 |
| updatedAt | updated_at | DateTime | @updatedAt | 수정일 |

### chat_messages

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 메시지 식별자 |
| session | - | ChatSession | 관계 (onDelete: Cascade) | 세션 참조 |
| sessionId | session_id | String | FK→chat_sessions, @@index([sessionId, createdAt]) | 세션 |
| role | role | String | - | 역할 ("user" \| "assistant") |
| content | content | String | - | 메시지 내용 |
| inputTokens | input_tokens | Int? | - | **크레딧 개편 I Phase** — API 응답 usage.input_tokens (assistant 만, 과거 무료 null) |
| outputTokens | output_tokens | Int? | - | **크레딧 개편 I Phase** — API 응답 usage.output_tokens |
| model | model | String? | - | **크레딧 개편 I Phase** — 모델 식별자 (차감 N 재산정용) |
| chargedPoints | charged_points | Int? | - | **크레딧 개편 I Phase** — 이 턴 차감 pt (4구간 정액). null = 미차감 |
| chargeTier | charge_tier | String? | - | **크레딧 개편 I Phase** — 차감 구간 short/normal/long/xlong |
| createdAt | created_at | DateTime | default(now()) | 작성일 |

> **크레딧 개편 I Phase (2026-05-17)**: 채팅 4구간 사후 차감 — 토큰 실측 5 필드 추가. 전부 nullable (§8-8 #3 — "0 토큰" vs "미측정" 구분).

### credit_ledgers (크레딧 개편 I Phase, 2026-05-17)

포인트 입출금 원장 — 1-C 하이브리드의 원장 측 (`authors.points_*` 4 필드는 잔액 캐시, 본 모델이 audit 정본).

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 원장 엔트리 식별자 |
| author | - | Author | 관계 (onDelete: **Restrict**) | 작가 참조 — 회계 영구 보존 (ADR-007) |
| authorId | author_id | String | FK→authors, @@index([authorId, createdAt]), @@index([authorId, source]) | 작가 ID |
| source | source | String | - | 출처: free/subscription/gift/charged (§8-2) |
| type | type | String | - | earn/spend/deficit_incur/deficit_settle/expire |
| amount | amount | Int | - | 변동 포인트 (부호 有) |
| balanceAfter | balance_after | Int | - | 이 row 직후 총 잔액 (4 출처 합) |
| expiresAt | expires_at | DateTime? | @@index([expiresAt]) | 구독풀 만료일 — 이월 구조적 차단 (§8-8 #2) |
| reason | reason | String | - | 변동 사유 |
| relatedId | related_id | String? | - | ChatMessage/Payment/AnalysisReport id 약결합 |
| createdAt | created_at | DateTime | default(now()) | 기록일 |

### membership_plans (크레딧 개편 I Phase, 2026-05-17)

멤버십 등급 + 월 포인트 풀 (4-C). 현행 `subscriptions`(독자→작가 팔로우)와 별개 도메인.

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 멤버십 식별자 |
| author | - | Author | 관계 (onDelete: **Restrict**) | 작가 참조 — 구독 이력 영구 보존 (ADR-007) |
| authorId | author_id | String | FK→authors, @@index([authorId]) | 작가 ID |
| tier | tier | String | default("free") | free/pro/premium |
| monthlyPoolPoints | monthly_pool_points | Int | default(0) | 월 풀 크기 (free 0 / pro 93,000 / premium 191,500) |
| poolBalance | pool_balance | Int | default(0) | 현재 잔여 풀 (캐시) |
| poolResetAt | pool_reset_at | DateTime | @@index([poolResetAt]) | 다음 리셋 시각 (cron + lazy) |
| startedAt | started_at | DateTime | default(now()) | 멤버십 시작일 |
| expiresAt | expires_at | DateTime? | - | 멤버십 만료일 |
| polarSubscriptionId | polar_subscription_id | String? | unique | Polar 연동 (별도 sprint) |
| status | status | String | default("active"), @@index([status]) | active/expired/cancelled |
| createdAt | created_at | DateTime | default(now()) | 생성일 |
| updatedAt | updated_at | DateTime | @updatedAt | 수정일 |

---

## 3. 크레딧 사유 코드

> 정본: `docs/glossary.md`

| reason | amount | 설명 |
|--------|--------|------|
| `signup_bonus` | +3 | 가입 보너스 |
| `first_work_bonus` | +2 | 첫 작품 등록 |
| `theme_generate` | -1 | 테마 최초 생성 |
| `theme_regenerate` | -1 | 테마 재생성 |
| `analysis_check` | -1 | 소설 일관성 분석 |
| `purchase_credit_N` | +N | 크레딧 구매 |
| `admin_set_by_{adminId}` | +N | 관리자 수동 부여 |

---

## 4. 복합 유니크 인덱스

| 테이블 | 컬럼 조합 | 목적 |
|--------|-----------|------|
| works | [authorId, slug] | 작가별 작품 슬러그 고유 |
| episodes | [workId, slug] | 작품별 에피소드 슬러그 고유 |
| social_accounts | [provider, providerId] | 제공자별 계정 고유 |
| bookmarks | [authorId, episodeId] | 독자별 에피소드 북마크 고유 |
| reading_progress | [authorId, episodeId] | 독자별 에피소드 진행도 고유 |
| likes | [authorId, episodeId] | 독자별 에피소드 좋아요 고유 |
| subscriptions | [subscriberId, targetAuthorId] | 구독 관계 고유 |

---

## 5. 관계 다이어그램

```
Author ──1:N── Theme
Author ──1:N── Work ──1:N── Episode
Author ──1:N── SocialAccount
Author ──1:N── CreditLog
ChatSession ──1:N── ChatMessage (cascade delete) (비정규화 — FK 없음, 감사용)
SignupHistory (독립 — 재가입 방지 전용)
Bookmark (authorId + episodeId — FK 없음, 독자 행위 기록)
ReadingProgress (authorId + episodeId — FK 없음, 독자 행위 기록)
Like (authorId + episodeId — FK 없음, 독자 행위 기록)
Subscription (subscriberId + targetAuthorId — FK 없음, 구독 관계)
Comment (authorId + episodeId — FK 없음, 소셜 기록)
Payment (authorId — FK 없음, 결제 기록)
WebhookEvent (eventId @unique — PG 웹훅 멱등성 박제, FK 없음)
ReconciliationCheckpoint (id='singleton' — PG↔DB 정합성 cron checkpoint, 단일 row, FK 없음)
RefundLog (paymentId — Polar 환불 webhook 환수 트랜잭션 박제, FK 없음 — 1:N 부분 환불 호환)
UserSanction (authorId + adminId — 제재/정지 이력)
Report (targetType + targetId — 신고 큐)
SystemSetting (key-value — 동적 설정)
AccessLog (action + authorId — 보안 접근 로그)
AdminAuditLog (adminId + action — 관리자 감사 로그)
```

### user_sanctions

사용자 제재/정지 이력. 경고 ~ 영구 정지 5단계.

| Prisma 필드 | DB 컬럼 | 설명 |
|-------------|---------|------|
| id | id | uuid PK |
| authorId | author_id | 대상 작가 |
| type | type | warning / suspend_1d / suspend_7d / suspend_30d / permanent |
| reason | reason | 욕설 / 스팸 / 저작권 / 기타 |
| detail | detail | 관리자 메모 (nullable) |
| adminId | admin_id | 제재를 건 관리자 |
| startAt | start_at | 시작 시각 (default now) |
| endAt | end_at | 해제 시각 (null = 영구) |
| isActive | is_active | 활성 여부 (default true) |
| createdAt | created_at | timestamptz |

### reports

콘텐츠 신고. pending → approved/rejected 처리.

| Prisma 필드 | DB 컬럼 | 설명 |
|-------------|---------|------|
| id | id | uuid PK |
| targetType | target_type | work / episode / comment |
| targetId | target_id | 신고 대상 ID |
| reporterId | reporter_id | 신고자 (nullable) |
| reason | reason | obscene / violence / copyright / spam / other |
| status | status | pending / approved / rejected |
| resolvedBy | resolved_by | 처리 관리자 (nullable) |
| resolvedAt | resolved_at | 처리 시각 (nullable) |
| createdAt | created_at | timestamptz |

### system_settings

동적 시스템 설정. 재배포 없이 변경 가능.

| Prisma 필드 | DB 컬럼 | 설명 |
|-------------|---------|------|
| key | key | PK — maintenance_mode, recaptcha_enabled, rate_limit_* |
| value | value | 설정 값 (text) |
| updatedBy | updated_by | 마지막 변경 관리자 |
| updatedAt | updated_at | timestamptz (@updatedAt) |

### access_logs

보안 접근 로그. 회원가입/로그인/관리자 활동 기록.

| Prisma 필드 | DB 컬럼 | 설명 |
|-------------|---------|------|
| id | id | uuid PK |
| action | action | register / login_success / login_fail / login_blocked / password_change / admin_login_* |
| authorId | author_id | 사용자 (nullable) |
| email | email | 시도한 이메일 (nullable) |
| ip | ip | 클라이언트 IP |
| userAgent | user_agent | 브라우저/봇 UA |
| detail | detail | 실패 사유 등 |
| createdAt | created_at | timestamptz |

### admin_audit_logs

관리자 행위 감사 로그. INSERT ONLY.

| Prisma 필드 | DB 컬럼 | 설명 |
|-------------|---------|------|
| id | id | uuid PK |
| adminId | admin_id | 행위 관리자 |
| action | action | author_create / credit_grant / episode_status_change / user_sanction / report_resolve / setting_change 등 |
| targetId | target_id | 대상 리소스 ID (nullable) |
| detail | detail | jsonb — 변경 전/후 값, 사유 |
| createdAt | created_at | timestamptz |

---

## 6. 참조 문서

- `prisma/schema.prisma` — 절대 정본
- `docs/data-model.md` — DB 스키마 정의 (공유 문서 정본)
- `docs/theme-spec.md` — AuthorTheme JSON 스키마 (overrides 필드 형식)
- `docs/glossary.md` — Block 타입, 크레딧 사유 코드 정의
- `MIGRATION.md` — 스키마 변경 절차 + 마이그레이션 규칙
