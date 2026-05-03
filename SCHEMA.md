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
| credits | credits | Int | default(3) | 크레딧 잔액 |
| plan | plan | String | default("free") | 구독 플랜 (free/pro/premium) |
| planExpireAt | plan_expire_at | DateTime? | - | 플랜 만료일 |
| theme | - | Theme? | 1:1 관계 | 작가 테마 |
| works | - | Work[] | 1:N 관계 | 작품 목록 |
| socialAccounts | - | SocialAccount[] | 1:N 관계 | 소셜 로그인 계정 |
| createdAt | created_at | DateTime | default(now()) | 가입일 |

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
| credits | credits | Int | - | 부여 크레딧 수 |
| externalTransactionId | external_transaction_id | String? | unique | 외부 결제 거래 번호 |
| status | status | String | default("pending") | 결제 상태 (pending/completed/failed) |
| createdAt | created_at | DateTime | default(now()) | 결제 요청일 |
| completedAt | completed_at | DateTime? | - | 결제 완료일 |

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
| createdAt | created_at | DateTime | default(now()) | 작성일 |

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
