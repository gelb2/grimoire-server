# SCHEMA.md — grimoire-server

> Prisma 스키마 구현 상세.
> 원본(정본): `docs/data-model.md` → 이 문서는 Prisma 구현 세부사항을 기술한다.

---

## 1. 스키마 위치

- `prisma/schema.prisma`
- Provider: PostgreSQL
- Binary targets: `native`, `linux-musl-arm64-openssl-3.0.x`, `linux-musl-openssl-3.0.x`

---

## 2. 모델 상세

### authors

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK, default(uuid()) | 작가 고유 식별자 |
| slug | slug | String | unique | URL 경로 (`/{slug}/`) |
| name | name | String | - | 작가명 |
| email | email | String | unique | 이메일 |
| credits | credits | Int | default(3) | 크레딧 잔액 |
| theme | - | Theme? | 1:1 관계 | 작가 테마 |
| works | - | Work[] | 1:N 관계 | 작품 목록 |
| createdAt | created_at | DateTime | default(now()) | 가입일 |

### themes

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 테마 식별자 |
| authorId | author_id | String | unique, FK→authors | 작가 (1:1) |
| preset | preset | String | default("midnight") | 프리셋명 |
| overrides | overrides | Json? | - | AuthorTheme 커스텀 값 (`docs/theme-spec.md` 참조) |
| rawDescription | raw_description | String? | - | 작가 원본 구술 텍스트 |
| updatedAt | updated_at | DateTime | @updatedAt | 수정일 |

### works

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 작품 식별자 |
| authorId | author_id | String | FK→authors | 작가 |
| slug | slug | String | @@unique([authorId, slug]) | URL 경로 |
| title | title | String | - | 작품 제목 |
| subtitle | subtitle | String? | - | 부제 |
| description | description | String? | - | 설명 |
| episodes | - | Episode[] | 1:N 관계 | 에피소드 목록 |
| createdAt | created_at | DateTime | default(now()) | 생성일 |

### episodes

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 에피소드 식별자 |
| workId | work_id | String | FK→works | 작품 |
| slug | slug | String | @@unique([workId, slug]) | URL 경로 |
| title | title | String | - | 제목 |
| subtitle | subtitle | String? | - | 부제 |
| orderNum | order_num | Int | - | 순서 |
| blocks | blocks | Json | - | 파싱된 Block[] (`docs/glossary.md` Block 타입 참조) |
| rawMd | raw_md | String | - | 원본 마크다운 |
| createdAt | created_at | DateTime | default(now()) | 생성일 |

### credit_logs

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| id | id | String (uuid) | PK | 로그 식별자 |
| authorId | author_id | String | - | 작가 ID |
| amount | amount | Int | - | 양수: 적립, 음수: 차감 |
| reason | reason | String | - | 변동 사유 (아래 표 참조) |
| createdAt | created_at | DateTime | default(now()) | 기록일 |

### signup_history

| Prisma 필드 | DB 컬럼 | 타입 | 제약 | 설명 |
|-------------|---------|------|------|------|
| providerId | provider_id | String | PK | OAuth provider ID |
| firstSignupAt | first_signup_at | DateTime | default(now()) | 최초 가입일 |
| signupCount | signup_count | Int | default(1) | 가입 횟수 |

---

## 3. 크레딧 사유 코드

| reason | amount | 설명 |
|--------|--------|------|
| `signup_bonus` | +3 | 가입 보너스 |
| `first_work_bonus` | +2 | 첫 작품 등록 |
| `theme_generate` | -1 | 테마 최초 생성 |
| `theme_regenerate` | -1 | 테마 재생성 |
| `purchase_credit_5` | +5 | 크레딧 구매 (5개) |
| `admin_set_by_{adminId}` | +N | 관리자 수동 부여 |

---

## 4. 관계 다이어그램

```
Author ──1:1── Theme
Author ──1:N── Work ──1:N── Episode
Author ──1:N── CreditLog (비정규화 — FK 없음, 감사용)
SignupHistory (독립 — 재가입 방지 전용)
```

---

## 5. 참조 문서

- `docs/data-model.md` — DB 스키마 정의 (정본)
- `docs/theme-spec.md` — AuthorTheme JSON 스키마 (overrides 필드 형식)
- `docs/glossary.md` — Block 타입 정의
