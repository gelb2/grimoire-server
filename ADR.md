# ADR (Architecture Decision Records) — ProjectGrimoire 백엔드

> 아키텍처 결정 기록: 왜 이 방식을 선택했는지, 어떤 대안을 검토했는지 기록한다.
> 면접/코드리뷰 시 "이 결정의 근거가 뭐냐"에 답할 수 있도록.
> 새로운 기술 결정 시 ADR-00N 형식으로 추가한다.

---

## 용어 사전

| 용어 | 설명 |
|------|------|
| **트랜잭션 (Transaction)** | DB 작업 여러 개를 "전부 성공 아니면 전부 취소"로 묶는 것. 은행 이체처럼 보내기+받기가 반드시 같이 돼야 함 |
| **롤백 (Rollback)** | 트랜잭션 중 하나라도 실패하면 전부 원래대로 되돌리는 것 |
| **데드락 (Deadlock)** | 두 작업이 서로 상대가 끝나기를 기다리며 영원히 멈추는 상태 |
| **경합 (Race Condition)** | 두 사용자가 동시에 같은 데이터를 바꿀 때 결과가 예측 불가능해지는 것 |
| **N+1 문제** | 목록 N개를 가져온 후 각각에 대해 추가 쿼리 1개씩 → 총 N+1번 DB 호출. 느림 |
| **인덱스 (Index)** | DB 테이블에 만드는 "목차". 특정 컬럼으로 검색할 때 전체를 안 훑고 바로 찾음 |
| **ORM** | 코드에서 SQL 대신 객체로 DB를 다루는 도구. Prisma가 이 프로젝트의 ORM |
| **도커라이징 (Dockerizing)** | 앱을 Docker 컨테이너로 포장. 어떤 서버에서든 동일하게 실행됨 |
| **무중단 배포** | 기존 서버를 끄지 않고 새 버전으로 교체. 사용자가 다운타임을 못 느낌 |
| **CORS** | 브라우저가 다른 도메인의 API를 호출할 때 허용/차단하는 보안 규칙 |
| **헥사고날 아키텍처** | 비즈니스 로직을 중심에 놓고, DB/API 등 외부를 "포트"로 연결. 교체 가능 |
| **시맨틱 캐싱** | "의미가 비슷한" 요청에 대해 이전 결과를 재사용. AI API 비용 절감 |

---

## ADR-001: 트랜잭션(Transaction) 원자성 보장

### 문제
결제 웹훅 성공 시 Payment 상태 변경 + 크레딧 증가 + CreditLog 기록이 동시에 일어나야 한다. 중간에 서버가 뻗으면 "돈은 냈는데 크레딧이 없는" 상태가 발생한다.

### 결정
Prisma `$transaction`으로 3개 작업을 단일 DB 트랜잭션으로 묶는다.

### 구현
```typescript
// payment.usecase.ts → processWebhook()
await this.prisma.$transaction(async (tx) => {
  await tx.payment.update({ where: { id }, data: { status: 'completed' } })
  await tx.author.update({ where: { id: authorId }, data: { credits: { increment } } })
  await tx.creditLog.create({ data: { authorId, amount, reason } })
})
```

### 왜 이 방식인가 (Trade-off)

| 대안 | 장점 | 왜 안 썼는가 |
|------|------|------------|
| 2PC (Two-Phase Commit) | 분산 DB 간 원자성 보장 | 단일 PostgreSQL이라 분산 트랜잭션 불필요. 도입하면 성능 저하 + 복잡성만 증가 |
| Saga 패턴 (보상 트랜잭션) | 마이크로서비스 간 느슨한 결합 | 모놀리스 NestJS에서 Saga는 오버엔지니어링. 보상 로직(결제 취소 API)을 별도로 구현해야 하는 부담 |
| Event Sourcing | 전체 이벤트 이력 추적 가능 | 이벤트 스토어 인프라 필요. CreditLog 테이블로 충분한 감사 추적이 이미 가능 |

### 감수하는 리스크

- **단일 DB 의존**: PostgreSQL 하나가 뻗으면 결제 처리 불가. 현재 규모에서는 Azure managed DB의 SLA(99.99%)로 충분
- **긴 트랜잭션**: 3개 쿼리를 묶으므로 락 유지 시간이 길어짐. 동시 결제 수가 초당 수십 건을 넘으면 병목. 현재는 초당 1건 미만이라 문제없음
- **스케일아웃 한계**: DB가 분산되면 이 구조를 버리고 Saga로 재설계해야 함

---

## ADR-002: 동시성 제어 (좋아요/크레딧 경합)

### 문제
수천 명이 동시에 같은 에피소드에 좋아요를 누르면 unique constraint 경합, 크레딧 동시 차감 시 race condition 발생 가능.

### 결정
- 좋아요: `unique(author_id, episode_id)` 제약조건 + upsert → DB 레벨에서 중복 방지
- 크레딧: `$transaction` 내에서 `increment/decrement` → PostgreSQL의 행 레벨 락 활용

### 구현
```typescript
// 좋아요 토글 — DB unique constraint가 중복 방지
await prisma.like.upsert({
  where: { authorId_episodeId: { authorId, episodeId } },
  create: { authorId, episodeId },
  update: {}, // 이미 있으면 삭제 (별도 로직)
})

// 크레딧 차감 — atomic increment
await tx.author.update({
  where: { id: authorId },
  data: { credits: { decrement: amount } },
})
// 잔액 검증
if (author.credits < 0) throw new Error('크레딧 부족')
```

### 왜 이 방식인가 (Trade-off)

| 대안 | 장점 | 왜 안 썼는가 |
|------|------|------------|
| SELECT ... FOR UPDATE (비관적 락) | 동시 접근 완벽 차단 | 모든 읽기에 락이 걸려 성능 저하. 좋아요는 읽기 빈도가 쓰기보다 압도적으로 높으므로 비관적 락은 과도 |
| Optimistic Locking (version) | 충돌 시에만 재시도 | 좋아요 토글이 초당 수백 건이 아닌 이상 unique constraint로 충분. version 관리 복잡성 대비 이점 없음 |
| Redis 분산 락 | 다중 인스턴스에서 안전 | max-replicas=1이라 단일 인스턴스. Redis 인프라 + 비용 추가가 불필요 |

### 감수하는 리스크

- **수평 확장 시 깨짐**: replicas를 2개 이상으로 늘리면 두 인스턴스가 동시에 같은 크레딧을 차감할 수 있음 → Redis 락 도입 필요
- **unique constraint 에러 처리**: 동시 좋아요 시 DB 에러(409)가 클라이언트에 노출될 수 있음 → catch로 무시 처리 중

---

## ADR-003: N+1 문제 방어

### 문제
작가 공간에서 "작품 목록 + 각 작품의 에피소드 수"를 조회할 때, 작품마다 별도 쿼리가 나가면 N+1 발생.

### 결정
Prisma `include` + `_count`로 단일 쿼리에서 관계 데이터를 함께 로드.

### 구현
```typescript
// prisma-work.repository.ts
const works = await this.prisma.work.findMany({
  where: { authorId },
  include: {
    _count: { select: { episodes: true } },
    author: { select: { name: true, slug: true } },
  },
})
```

### 왜 이 방식인가 (Trade-off)

| 대안 | 장점 | 왜 안 썼는가 |
|------|------|------------|
| Raw SQL JOIN | 쿼리 완전 제어 | 타입 안전성 상실 + SQL 관리 부담. Prisma의 include가 내부적으로 최적화된 쿼리를 생성하므로 직접 쓸 이유 없음 |
| DataLoader 패턴 | 배치 로딩으로 N+1 완벽 해결 | GraphQL용 도구. REST API에서는 Prisma include로 충분. DataLoader 도입 시 코드 복잡성 증가 |
| Materialized View | 읽기 성능 최고 | 데이터 변경 시 View 갱신 필요. 작품 수가 100개 미만인 현재 규모에서 유지보수 부담만 증가 |

### 감수하는 리스크

- **Prisma 쿼리 품질 의존**: Prisma가 비효율적인 쿼리를 생성할 수 있음. `EXPLAIN ANALYZE`로 모니터링 필요
- **작품 수 증가 시**: 수천 개 이상이면 `include`보다 pagination + cursor 기반 조회로 전환 필요

---

## ADR-004: 쿼리 최적화와 인덱스

### 문제
인기 작품 조회, 최신 작품 조회, 작가 검색 등에서 데이터 증가 시 쿼리 성능 저하 가능.

### 결정
Prisma 스키마에서 복합 인덱스 정의 + 페이지네이션 적용.

### 구현
```prisma
// schema.prisma
model Work {
  @@index([authorId])
  @@unique([authorId, slug])
}

model Episode {
  @@unique([workId, slug])
  @@index([workId, orderNum])
}

model DailyView {
  @@unique([workId, date])
}
```

페이지네이션:
```typescript
const works = await this.prisma.work.findMany({
  orderBy: { viewCount: 'desc' },
  skip: (page - 1) * pageSize,
  take: pageSize,
})
```

### 왜 이 방식인가 (Trade-off)

| 대안 | 장점 | 왜 안 썼는가 |
|------|------|------------|
| Cursor-based 페이지네이션 | 대규모 데이터에서 일정한 성능 | offset 페이지네이션이 구현 단순하고, 작품 수가 수백 개 미만이라 성능 차이 없음 |
| Elasticsearch | 전문 검색 최고 성능 | 별도 인프라 + 비용. `ILIKE` + pg_trgm으로 현재 규모 충분 |
| Redis 캐시 | 인기 작품 조회 캐싱 | 인프라 추가 비용. DB 쿼리가 인덱스로 충분히 빠름 (ms 단위) |

### 감수하는 리스크

- **offset 페이지네이션 한계**: 10만 건 이상에서 `OFFSET 90000`은 느림 → cursor 기반으로 전환 필요
- **ILIKE 검색 한계**: 한글 형태소 분석 없음 → "나무꾼"으로 "선녀와 나무꾼" 검색 가능하지만, "나무"로는 불가

### 모니터링 방법
```sql
EXPLAIN ANALYZE SELECT * FROM works ORDER BY view_count DESC LIMIT 12;
```

---

## ADR-005: 도커라이징과 배포

### 결정
Docker 멀티스테이지 빌드로 단일 이미지를 만들고, 환경변수만 바꿔서 2환경(dev/prod) 배포. (2026-04-19: inhouse 제거)

### 구현
```dockerfile
# Dockerfile (서버)
FROM node:20-alpine AS builder
RUN npm ci && npx prisma generate && npm run build

FROM node:20-alpine AS runner
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### 배포 흐름
```
develop → docker build → ACR push → Container Apps update (dev)
main    → 같은 이미지 → Container Apps update (prod)
```

### 왜 이 방식인가 (Trade-off)

| 대안 | 장점 | 왜 안 썼는가 |
|------|------|------------|
| 환경별 별도 이미지 | 빌드 시 환경 최적화 | "dev에서 됐는데 prod에서 안 됨" 발생. 단일 이미지 + 환경변수 주입이 불일치 위험 제거 |
| Kubernetes | 완전한 오케스트레이션 | 학습 곡선 + 운영 복잡성. Container Apps가 K8s 기반이면서 관리형이라 운영 부담 없음 |
| Serverless (Azure Functions) | 완전 무료 tier 가능 | NestJS의 미들웨어/가드/DI가 Functions와 호환 안 됨. Cold Start 3~5초로 UX 저하 |
| Vercel/Netlify | 프론트엔드 배포 최적화 | 백엔드(NestJS)는 배포 불가. 프론트+백엔드 동일 인프라에서 관리하는 게 운영 단순 |

### 감수하는 리스크

- **min-replicas=0**: 사용자가 없으면 컨테이너가 꺼짐 → 첫 요청 시 Cold Start 10~15초. min-replicas=1로 올리면 월 비용 증가
- **단일 리전**: Korea Central에만 배포. 해외 사용자는 지연 발생. CDN(Cloudflare)으로 정적 자산은 캐싱됨
- **Container Apps 제한**: 무료 tier에서 Environment 1개만 가능 → ProjectZenith와 공유 중

---

## ADR-006: Polar SDK timeout 정책 + exception 분기 처리 (PAY-P3-B, 2026-05-09)

### 문제

Polar SDK 호출 시 (PAYMENT_AUDIT §1 구멍-C):
1. **Timeout 미명시**: `new Polar({ accessToken, server })`만 호출 → SDK 기본값 의존 → 네트워크 hang 시 워커 자원 leak 가능
2. **Exception 미분류**: 모든 catch 블록에서 `e.message` 단순 추출만 → SDK가 throw하는 다양한 에러 (`RequestTimeoutError`, `ConnectionError`, `PolarError 4xx/5xx`)를 동일 처리
3. **Retry 정책 모순**: 모든 exception → DLQ 박제 → MAX_RETRY 10회 누적 → permanent_failed
   - `timeout`/`network`/`5xx`: retry 의미 있음 (일시적 장애)
   - `4xx` (예: Bad Request, Unauthorized): retry 의미 **없음** (요청 결함, 10회 시도 무의미) → 운영 부담 + 50분 cron 지연

### 결정

**옵션 A 채택** — Polar SDK v0.47.0 SDKOptions.timeoutMs 내장 옵션 (config.d.ts L38 `timeoutMs?: number` 직접 지원).

```typescript
this.polar = new Polar({ accessToken, server, timeoutMs: this.timeoutMs })
```

**Exception 5분류 매트릭스** (`classifyPolarError(e)`):

| errorClass | 트리거 | retry 분기 |
|---|---|---|
| `timeout` | AbortError, TimeoutError, RequestTimeoutError, RequestAbortedError, /timeout/i | retry |
| `network` | ECONNRESET, ENOTFOUND, ETIMEDOUT, EPIPE, ECONNREFUSED, ConnectionError | retry |
| `server_5xx` | HTTP 500/502/503/504 (PolarError.statusCode 추출) | retry |
| `client_4xx` | HTTP 400/401/403/404/422 | **permanent_failed 즉시** |
| `unknown` | 분류 실패 시 안전 fallback | retry |

### 구현

- `polar.adapter.ts` — `classifyPolarError` public method (duck typing, SDK 내부 import 의존 0)
- `payment.usecase.ts` — `classifyAndRouteWebhookError` private helper (success/cancel 양 분기 catch에서 호출)
- `payment-gateway.port.ts` — `classifyPolarError?` Optional 메서드 (옵션 B 채택, 다른 adapter 정합)
- `enqueueWebhookRetry(event, eventId, eventClass)` 시그니처 보강 (`eventClass='permanent_failed'` 시 retry queue 박제 0건)

### 왜 이 방식인가 (Trade-off)

| 후보 | 장점 | 단점 |
|---|---|---|
| **옵션 A (SDK 내장 timeoutMs)** | SDK 정본 옵션 활용 + 모든 호출에 자동 적용 + env 오버라이드 가능 | SDK 버전 종속 (v0.47.0+ 필수) |
| 옵션 B (호출별 AbortSignal.timeout wrapper) | SDK 버전 독립 | 호출 위치마다 wrap 필요 + 코드 중복 |
| 옵션 C (호출별 retry policy custom) | 세밀한 제어 | 복잡도 증가 + Polar SDK retryConfig와 충돌 가능 |

**duck typing 사용 사유**: `e.statusCode` / `e.response?.status` / `e.status` 후보 다중 검증 → SDK 내부 import 의존 최소화 (SDK 버전 업그레이드 회귀 차단).

### 감수하는 리스크

- **timeoutMs 30s 기본값**: 일시적 네트워크 지연 시 timeout 분기 진입 → retry 시도. 운영에서 너무 짧으면 env로 60s 등 조정 가능.
- **classifyPolarError Optional**: 다른 adapter (예: 향후 PayApp) 미구현 시 호출자가 'unknown' fallback 처리 (retry 분기 → 안전 측면)
- **4xx 즉시 permanent_failed**: AuditLog `webhook_permanent_failed` 박제로 운영 추적 가능. 운영 중 4xx 트리거 패턴 발견 시 root cause 즉시 분석 가능.

---

## ADR-007: FK Cascade 정책 (모순-F 차단, PAY-P3-E, 2026-05-10)

### 결정

Prisma schema 33 FK 관계 모두 `onDelete` directive 명시 강제. 4 전략 (Cascade / Restrict / SetNull / NoAction) 도메인 의미 + 보존 정책 + 감사 정합 기준 결정. raw FK 25 영역에 `@relation` directive 신설 + PG FK 제약 마이그레이션 적용 (ALTER TABLE 33 + DROP NOT NULL 2 영역).

### 4 전략 분포 (33 FK 정합, Sprint §3-1 매트릭스 정합)

#### Cascade 16건 (사용자 종속 + Work/Episode 종속 + 통계)

`refresh_tokens.authorId` / `chat_sessions.authorId` / `chat_sessions.workId` / `bookmarks.authorId` / `bookmarks.episodeId` / `reading_progress.authorId` / `reading_progress.episodeId` / `social_accounts.authorId` / `subscriptions.subscriberId` / `subscriptions.targetAuthorId` / `daily_views.workId` / `featured_works.workId` / `comments.episodeId` / `likes.episodeId` / `episodes.workId` / `chat_messages.sessionId` (이미 박제)

**사유**: 사용자 삭제 시 즉시 무효 (refresh_tokens) + Work 삭제 시 모든 episode/통계 동시 삭제 (작가 의도 정합) + 사용자 행위 기록 (북마크/읽기/구독)은 사용자 종속.

#### Restrict 8건 (회계/세무/감사 영구 보존, **Author hard delete 차단 강제**)

`payments.authorId` / `credit_logs.authorId` / `works.authorId` / `user_sanctions.authorId` / `analysis_reports.authorId` / `admin_audit_logs.adminId` / `refund_logs.paymentId`

**사유**: Author hard delete 시 PG가 자동 차단 영역 정합 (USER-SOFT-DELETE sprint 영역 진입 전 본 sprint 영역에서 차단 강제). 회계/세무 7년 보존 정책 + 감사 영구 보존 정책 + 작가 콘텐츠 영구 보존 + 재가입 추적 영역 정합. 사용자 결정 A 정합 (5/9 박제) — Author hard delete 자체는 USER-SOFT-DELETE sprint 영역 분리.

#### SetNull 9건 (익명화 + 운영자 변경 보존 + 기본값 유지)

`themes.authorId` / `works.themeId` / `likes.authorId` / `comments.authorId` / `comments.parentId` / `reports.reporterId` / `reports.resolvedBy` / `access_logs.authorId` / `featured_works.adminId` / `user_sanctions.adminId`

**사유**: 작가 자율 탈퇴 시 콘텐츠 영구 보존 + 본인 식별 정보만 익명화 (Comment.content 보존, Like 카운트 보존). 운영자 변경 시 처리 기록 보존 (FeaturedWork/UserSanction.adminId). Theme 삭제 시 Work는 default theme 유지. AccessLog 보안 감사 영구 보존 (IP/UA 보존, authorId 익명화).

### 단계 1+2 raw 박제 영역 정합 (시나리오 B 영역 회복)

**dev DB 측정 결과 (단계 1, 2026-05-10)**:
- 33 FK 중 31 = 시나리오 A (orphan=0)
- 2 FK = 시나리오 B (`credit_logs.author_id` 1 + `admin_audit_logs.admin_id` 2 = 3 row)

**옵션 C archive 강제 박제 (단계 2, 2026-05-10)**:
- archive 테이블 신설: `credit_logs_archive_pay_p3_e` + `admin_audit_logs_archive_pay_p3_e` (LIKE INCLUDING ALL clone)
- INSERT 3 row → DELETE 3 row → 33/33 시나리오 A 회복 강제 박제
- 회계/감사 영역 영구 보존 정합 (옵션 B 직접 삭제 절대 금지 영역)

### 자동 동작 영역 매트릭스 (33 FK 영역)

| FK | onDelete | Author/Work 삭제 시 동작 |
|---|---|---|
| works.authorId | Restrict | Author 삭제 차단 (FK 제약 위반 throw P2003) |
| credit_logs.authorId | Restrict | Author 삭제 차단 |
| payments.authorId | Restrict | Author 삭제 차단 |
| episodes.workId | Cascade | Work 삭제 시 episode 자동 삭제 |
| social_accounts.authorId | Cascade | Author 삭제 시 자동 cascade (단 위 Restrict 영역 0건일 때만) |
| comments.authorId | SetNull | Author 삭제 시 authorId → null (content 보존) |
| likes.authorId | SetNull | Author 삭제 시 authorId → null (카운트 보존) |
| access_logs.authorId | SetNull | Author 삭제 시 authorId → null (보안 감사 보존) |

### 회귀 차단

- jest server 661 → **669 PASS** (+8 it 신설, `prisma-fk-cascade.spec.ts`)
- eval regression: 사용자 검증 후 신설 영역
- sensor: `sensor-fk-cascade-policy.sh` 사용자 검증 후 신설 영역

### 감수하는 리스크

- **Author 모델 비대화**: Prisma 양방향 @relation 강제 영역 정합 — Author 모델 27 역참조 박제 강제 (themes/works/socialAccounts 외 24 추가). 단 raw FK 영역 자체 강제 영역 정합 (회피 영역 0건).
- **Optional 변경 영역**: FeaturedWork.adminId / UserSanction.adminId Required → Optional 변경 (SetNull 정합). 기존 row 영향 0건 (단계 1 측정 정합) + 향후 신설 row 영역 변경 강제.
- **dev 영역 24h 안정성 박제 후만 prod 진입**: prod 영역 영향 (33 FK 묵시 Restrict → 명시 4 전략 변경) 정합 박제 영역.

### 정본 영역

- `prisma/schema.prisma` (33 FK 영역 + 25 raw FK @relation 박제)
- `prisma/migrations/20260510_pay_p3_e_fk_cascade_policy/migration.sql` (ALTER TABLE 33 + DROP NOT NULL 2 영역)
- `src/adapter/outbound/persistence/prisma-fk-cascade.spec.ts` (8 it 박제)
- `docs/data-model.md` 관계 다이어그램 영역 갱신
- `.claude/shared-contracts.md §25 FKCascadePolicy` (예정)
- `.claude/state/sprint-pay-p3-e-fk-cascade-draft.md` (Initializer 정본, 1233 lines)
- `.claude/state/pay-p3-e-fk-measure-raw.md` (단계 1 raw)
- `.claude/state/pay-p3-e-fk-backfill-raw.md` (단계 2 raw)
- `.claude/state/pay-p3-e-pre-migration-audit-draft.md` (단계 3 진입 audit, PASS)
- `.claude/state/pay-p3-e-dev-migration-raw.md` (단계 3+4 진행 박제, 본 작업 영역)

---

## ADR-009: Polar SDK 호출 경계 Circuit Breaker 도입 (PAY-P3-H, 2026-05-15)

### 상태
ACCEPTED (사용자 5/15 결정 Draft §16 권장값 전부 채택 정합)

### 컨텍스트
- PAY-P3-B (Polar SDK timeout 정책, ADR-006 + shared-contracts §24) 종료 시점 잔존 문제:
  - Polar SDK 장애 누적 시 retry queue 폭주 (timeout 30s × N 누적)
  - 회복 시점 자동 감지 부재 (5분 cron 폭주 지속)
  - fail-fast 부재 (사용자 응답 30s 대기)
- 사용자 5/10 명시 정합: 외부 API 0건 / DB schema 0건 / dev migration 0건 강제
- 외부 npm 라이브러리 (opossum / cockatiel) 도입 0건 정합 (자체 구현)
- 사용자 5/15 결정 정합: Draft §16 권장값 전부 채택 (옵션 B Hystrix 정합 + 3 호출점 + env 4건 + AuditLog 4 action + 관리자 UI 별도 sprint)

### 결정
- Hystrix 3 상태 머신 패턴 채택 (CLOSED / OPEN / HALF_OPEN)
- 임계값 정책: 옵션 B Hystrix 정합 (failureThreshold=5, cooldownMs=30_000, halfOpenTrial=3, resetWindowMs=60_000)
- 상태 저장: in-memory (단일 인스턴스 가정, 다중 인스턴스는 별도 sprint)
- 적용 영역: Polar SDK 2 호출점 박제 (checkouts.create / checkouts.list) — checkouts.get는 현재 코드 미존재 (Draft §8-1 "있을 시" 정합, 향후 추가 시 자동 적용)
- AuditLog 박제 매트릭스: `circuit_breaker.open` / `circuit_breaker.close` / `circuit_breaker.half_open_trial` / `circuit_breaker.reject` (4 action)
- env 4건: `POLAR_CB_FAILURE_THRESHOLD` / `POLAR_CB_COOLDOWN_MS` / `POLAR_CB_HALF_OPEN_TRIAL` / `POLAR_CB_RESET_WINDOW_MS`
- CircuitOpenError 분기: PaymentUseCase.initiatePayment → ServiceUnavailableException(503) 변환, PaymentReconciliationJob → cron skip

### 대안
- (A) opossum npm 라이브러리 — 외부 의존 추가 (사용자 5/10 정합 X, 거부)
- (B) cockatiel npm 라이브러리 — 동일 사유 거부
- (C) Redis 기반 분산 상태 — 인프라 추가 (사용자 5/10 정합 X, 거부) — 다중 인스턴스 시점 별도 sprint
- (D) 자체 구현 + in-memory ← **채택** (외부 의존 0건 + 인프라 0건 + DB 0건)

### 구현
- domain/model: `src/domain/model/circuit-breaker-state.ts` (enum + Policy + Stats + CircuitOpenError)
- domain/port: `src/domain/port/outbound/circuit-breaker.port.ts` (CircuitBreakerPort 인터페이스)
- adapter: `src/adapter/outbound/circuit-breaker/in-memory-circuit-breaker.adapter.ts` (Map 기반 단일 인스턴스 구현)
- app.module DI: `'CircuitBreakerPort' → InMemoryCircuitBreakerAdapter` (PolarAdapter 영역 Optional 주입)
- 적용 영역: `src/adapter/outbound/payment/polar.adapter.ts` (initiatePayment + listRecentCheckouts 래핑)
- 호출자 분기: `src/application/payment/payment.usecase.ts` (CircuitOpenError → ServiceUnavailableException), `src/application/payment/payment-reconciliation.job.ts` (cron skip)
- spec: `in-memory-circuit-breaker.adapter.spec.ts` (18 it) + `polar.adapter.spec.ts` (+4 it) + `payment.usecase.spec.ts` (+2 it) — 합계 +24 it

### 결과
- Polar 장애 시 retry queue 폭주 0건 (OPEN 상태에서 SDK 호출 0건)
- 회복 자동 감지 (HALF-OPEN 3회 trial 모두 성공 시 CLOSED 복귀)
- 사용자 응답 시간 ↓ (fail-fast 즉시 503 응답)
- 운영 로그 noise ↓ (대량 timeout 박제 0건)
- AuditLog 4 action 박제 강제 (운영 모니터링 + 사후 분석 정합)

### 잔존 영역
- 다중 인스턴스 환경 — in-memory 상태 분리 (Redis 별도 sprint)
- 정책 변경 시 Container Apps 재시작 필요 (in-memory 0 초기화)
- 관리자 UI (forceOpen/forceClose) — P3-I 별도 sprint 분리 (port 인터페이스만 본 sprint 박제)
- 호출 빈도 인벤토리 박제 필요 (운영 모니터링 영역)

### 정본 영역
- `src/domain/model/circuit-breaker-state.ts`
- `src/domain/port/outbound/circuit-breaker.port.ts`
- `src/adapter/outbound/circuit-breaker/in-memory-circuit-breaker.adapter.ts`
- `src/adapter/outbound/circuit-breaker/in-memory-circuit-breaker.adapter.spec.ts`
- `.claude/shared-contracts.md §27 CircuitBreakerPolicy`
- `.claude/state/sprint-pay-p3-h-circuit-breaker-draft.md` (Initializer 정본, 17 섹션)

---

## ADR-010: Status enum + Polar 매핑 정책 (PAY-P3-D, 2026-05-15)

### 상태
ACCEPTED (사용자 5/15 verbatim 4번째 sprint 정합)

### 컨텍스트
- 결제 도메인 영역 status literal 영역 분산 (5 영역):
  - DB `payments.status` String (5 values)
  - DB `webhook_events.status` String (3 values)
  - Port `NormalizedWebhookEvent.status` literal (3 values)
  - Port `NormalizedCheckout.status` literal (4 values)
  - DB `refund_logs.source` String (2 values)
- 매핑 함수 영역 polar.adapter.ts private 메서드 2개 (`mapOrderStatus` + `mapCheckoutStatus`) → 도메인 영역 분리 부재 (헥사고날 DIP 결함)
- 어휘 통일 부재 → IDE 자동완성 X / 오타 영역 컴파일 단계 차단 X / race condition 게이트 분산 (`payment.status === 'refunded' || === 'partial_refunded'` 영역 반복)
- 사용자 5/15 verbatim 정합: schema 변경 0 / dev migration 0 / 외부 API 0 강제

### 결정
- TypeScript `as const` 객체 영역 5 enum 박제 (zero runtime cost + IDE 자동완성)
- 매핑 함수 2건 도메인 model 이전 (`mapPolarOrderStatus` + `mapPolarCheckoutStatus`)
- helper 3건 박제 (race condition 통합 + Polar status 판정)
- 호출자 통합 영역: polar.adapter.ts (위임) + payment.usecase.ts (어휘 통합 + race helper 통합)
- DB schema 영역 변경 0건 (Prisma `String` 컬럼 유지)
- sensor-payment-race-condition 패턴 영역 helper 호출 영역 정합화 (회귀 보존 강제)

### 대안
- (A) DB enum 변환 — Prisma `enum` schema 마이그레이션 (사용자 5/15 정합 X, 거부 — dev migration 0 강제)
- (B) Branded type — Runtime 검증 부재 (거부)
- (C) zod schema — 외부 npm 의존 추가 (사용자 5/15 정합 X, 거부)
- (D) `as const` 객체 + TypeScript literal type ← **채택** (zero runtime cost + 외부 의존 0건)

### 구현
- domain/model: `src/domain/model/payment-status.ts`
- domain/model spec: `src/domain/model/payment-status.spec.ts` (34 it)
- polar.adapter 통합: `src/adapter/outbound/payment/polar.adapter.ts` (import + private 메서드 위임)
- payment.usecase 통합: `src/application/payment/payment.usecase.ts` (import + 4 영역 어휘 통합)
- sensor: `.claude/scripts/sensor-payment-status-mapping.sh` (10 검증)
- regression: `eval/tasks/regression-72-payment-status-mapping.json` (10 criteria)

### 결과
- 헥사고날 DIP 정합 강화 (매핑 함수 도메인 model 이전)
- 어휘 통일 — TypeScript IDE 자동완성 + 오타 영역 컴파일 단계 차단
- jest 735 → 769 PASS (+34 it — payment-status spec)
- sensor-payment-race-condition 영역 helper 호출 영역 정합화 (회귀 보존)
- DB schema 0건 / dev migration 0건 / 외부 API 0건 정합 강제

### 잔존 영역
- DB schema 영역 enum 변환 (별도 sprint PAY-P4-x 영역 후보)
- 4 status literal 위치 영역 통합 — payment.usecase.ts 영역 `status: 'processed'` 영역 추가 통합 (회귀 최소화 정합으로 1회만 박제, 후속 sprint 후보)
- 다른 사용 영역 (admin.usecase / refund-payment.usecase 등) — 어휘 통합 후속 sprint 후보

### 정본 영역
- `src/domain/model/payment-status.ts`
- `src/domain/model/payment-status.spec.ts`
- `.claude/shared-contracts.md §28 PaymentStatusMapping`
- `.claude/scripts/sensor-payment-status-mapping.sh`
- `eval/tasks/regression-72-payment-status-mapping.json`

---

## ADR-008: audit log 영구 보존 + PII 마스킹 정책 (PAY-P2-5, 2026-05-10)

### 컨텍스트
- 4 audit 모델 (AdminAuditLog / WebhookEvent / WebhookRetryQueue / AccessLog)에 보존 정책 부재 (PAYMENT_AUDIT-2026-05-07.md §3 L84-85)
- 전자상거래법 5년 보존 의무 + 개인정보 보호법 마스킹 의무 정합 필요
- dev 측정 결과 (5/10): 전체 row 22 / 90일 경과 row 0건 (시나리오 A)

### 결정 (사용자 5/10 verbatim "d로 하고")
- **영구 보존**: DELETE 0건 강제 (audit gap 0)
- **90일 후 PII 마스킹**: audit-mask.scheduler 매일 03:00 KST cron
- **PII 7 키 자동 검출**: email / phone / ipAddress / userAgent / passwordHash / token / secret
- **보존 키 매트릭스**: id / userId / authorId / adminId / action / createdAt / amount / credits 등 audit 본질 보존

### 구현
- 4 모델 schema: `maskedAt DateTime?` + `retentionTier String @default("active")` 컬럼 신설
- migration: `prisma/migrations/20260510_pay_p2_5_audit_retention_policy/migration.sql` (4 ALTER TABLE + 8 ADD COLUMN + 4 INDEX)
- helper: `src/adapter/outbound/persistence/audit-mask-helper.ts` (PII 7 키 자동 검출 + JSON deep masking)
- scheduler: `src/scheduler/audit-mask.scheduler.ts` (`@Cron('0 0 3 * * *')` 매일 03:00 KST)

### 결과
- audit gap 0 (DELETE 0건)
- 법적 정합 (5년 보존 + PIPA 마스킹)
- 사용자 식별자 보존 (audit 본질)
- 마스킹 cron 첫 실행 noop 정합 (dev 90일 경과 row 0건)

### 정본 영역
- `prisma/schema.prisma` (4 모델 컬럼 추가)
- `prisma/migrations/20260510_pay_p2_5_audit_retention_policy/migration.sql`
- `src/adapter/outbound/persistence/audit-mask-helper.ts` (신설)
- `src/scheduler/audit-mask.scheduler.ts` (신설)
- `.claude/shared-contracts.md §26 AuditRetentionPolicy` (예정)
- `.claude/state/sprint-pay-p2-5-audit-retention-draft.md` (Initializer 정본, 17 섹션)
- `.claude/state/pay-p2-5-dev-measure-raw.md` (단계 1 측정 raw, 시나리오 A)

---

## ADR-011: Author Soft Delete + 본인 탈퇴 + 운영자 강제 삭제 + GDPR 익명화 + 30일 cron hard delete (USER-SOFT-DELETE, 2026-05-15)

### 상태
ACCEPTED (사용자 5/15 verbatim 정합 "B + A 모두 진행" — 5/10 verbatim "USER-SOFT-DELETE ... 이건 순서대로", PAY-P3-E sprint 단계 1~6 종료 직후 5번째 sprint)

### 컨텍스트
- PAY-P3-E sprint §7-1 단계 1~6 종료 박제 직후 (5/11 박제) — FK 제약 박제 + 회계 8건 Restrict 강제 정합
- Author 모델 deletedAt 컬럼 박제 0건 — 본인 탈퇴 / 운영자 강제 삭제 / GDPR 익명화 영역 모두 차단 상태
- Prisma soft delete middleware 박제 0건 — 향후 확장 패턴 부재
- 30일 후 hard delete 자동화 부재 — soft delete 영역 누적
- 사용자 5/15 verbatim 정합: "B + A 모두 진행" — 5번째 sprint = USER-SOFT-DELETE
- 사용자 5/9 결정 A 정합: USER-SOFT-DELETE sprint 분리 신설 (Author hard delete 자체가 일상 운영에서 발생 X)
- GDPR Article 17 (Right to Erasure) 정합 필요

### 결정
- **옵션 D 채택**: User.deletedAt DateTime? + Prisma `$use` middleware + 30일 cron hard delete
- Prisma `$use` middleware 영역 자동 적용 (Author 영역 + 향후 확장 가능 영역)
- GDPR 익명화 옵션 A (basic — email + name + passwordHash + bio) 채택 (사용자 5/15 결정)
- 30일 후 hard delete 자동화 (cron `0 0 4 * * *` 매일 새벽 4시 KST + 회계 8건 P2003 차단 영역 try-catch)
- RefreshToken 즉시 무효 (PAY-P3-E Cascade 박제 영역 정합 강화 — soft delete 시점에 별도 호출)
- AdminAuditLog 4 action 박제 (`self_account_delete` / `admin_force_delete` / `gdpr_anonymize` / `30d_hard_delete` + `30d_hard_delete_blocked`)

### 대안
- (A) User.isDeleted Boolean — 2 컬럼 정합성 영역 부담 (거부: isDeleted=true + deletedAt=null 불가능 강제 시 이중 검증)
- (B) 별도 DeletedUser archive 테이블 — PAY-P3-E Restrict 정합 X (거부, 회계 영역 FK dangling — Payment authorId → archive 영역 0건)
- (C) 환경별 분리 (dev/prod) — 일관 영역 0건 (거부: 단일 정합 강제)
- (D) User.deletedAt DateTime? + middleware + cron ← **채택** (DDD-aware + 영역 검증 + 시점 박제 + cron 정합 + GDPR 정합)

### 정본 영역
- model: `prisma/schema.prisma` Author 모델 deletedAt 컬럼 + `@@index([deletedAt])`
- migration: `prisma/migrations/20260515_user_soft_delete_policy/migration.sql`
- domain model: `src/domain/model/author.ts` (deletedAt 필드 + isAuthorDeleted) + `src/domain/model/user-soft-delete-state.ts` (SoftDeleteState enum)
- policy: `src/domain/policy/user-soft-delete-policy.ts` (UserSoftDeletePolicy + computeHardDeleteCutoff)
- port: `src/domain/port/outbound/user-anonymizer.port.ts` + `src/domain/port/outbound/author-repository.port.ts` (softDelete/restore/hardDeleteOlderThan/findDeletedById/findDeletedOlderThan 메서드 추가)
- adapter: `src/adapter/outbound/persistence/prisma-soft-delete.middleware.ts` + `src/adapter/outbound/persistence/default-user-anonymizer.adapter.ts`
- usecase: `src/application/author/user-soft-delete.usecase.ts`
- cron: `src/application/author/user-hard-delete.job.ts` (`@Cron('0 0 4 * * *')`)
- controller (self): `src/adapter/inbound/http/controller/author.controller.ts` (`@Delete('me')`)
- controller (admin): `src/adapter/inbound/http/controller/admin.controller.ts` (`@Post('authors/:authorId/force-delete')`)
- spec (4): user-soft-delete.usecase.spec.ts + prisma-soft-delete.middleware.spec.ts + default-user-anonymizer.adapter.spec.ts + user-hard-delete.job.spec.ts (total 28 it 신설)
- sensor: `.claude/scripts/sensor-user-soft-delete-policy.sh` (12 검증)
- eval: `eval/tasks/regression-73-user-soft-delete-policy.json` (12 criteria)
- 정본 박제: `.claude/shared-contracts.md §29 UserSoftDeletePolicy`
- Sprint Initializer: `.claude/state/sprint-user-soft-delete-draft.md` (17 섹션 + §0-1 + §18 + §19)

### 결과
- 본인 탈퇴 기능 영역 가능 (마이페이지 영역 UI + API — DELETE /api/v1/authors/me)
- 운영자 강제 삭제 영역 가능 (admin 14탭 회원 관리 영역 UI + API — POST /admin/authors/:id/force-delete)
- GDPR Right to Erasure 정합 (Article 17 영역)
- 회계 영역 영구 보존 (PAY-P3-E Restrict 정합 강화 — soft delete 시에도 PG 자동 차단)
- 30일 후 자동 정리 (디스크 영역 + DB 인덱스 성능 영역)
- jest 769 → 797 PASS (+28 it 신설, 회귀 0건)
- sensor-user-soft-delete-policy.sh 12/12 PASS

### 잔존 영역
- Work / Episode soft delete — 별도 sprint 영역 (작가 콘텐츠 영역 정책 영역)
- Subscription 본인 탈퇴 시 자동 cancel — 별도 sprint 영역 (Polar 정합)
- 다중 인스턴스 환경 — middleware in-memory 0건 (Prisma 영역 단일 정합)
- GDPR 옵션 B (strong — IP + userAgent) / C (strongest — 콘텐츠 anonymize) — 향후 환경변수 영역 확장 영역
- dev migration apply — 별도 grimoire-infrastructure agent 영역 진입 시점 명시 영역
- prod migration — dev 24h 안정성 박제 후만 사용자 명시 영역
- web UI 영역 — 별도 grimoire-web agent Generator 진입 영역 (마이페이지 탈퇴 버튼 + admin 강제 삭제 모달)

---

## ADR-012: 크레딧 디노미네이션 + 포인트 출처 분리 회계 + 채팅 4구간 차감 (크레딧 개편 I Phase, 2026-05-17)

### 상태
ACCEPTED — 사용자 결정 게이트 6건 통과 (5/17, S Phase Draft §16-1 권장값 1-C/2-C/5필드/4-C/5/6-B 일괄 채택).

### 컨텍스트
- 정수 크레딧(`Author.credits Int`)은 채팅 가변 비용을 표현 불가 — 짧은 턴 바가지·긴 턴 적자(§0 위반).
- 단일 Int 로는 포인트 출처 4종(무료적립/구독풀/응원선물/충전)을 분리 회계할 수 없음 — CAC/COGS 미분리.
- 정본: `research/CREDIT_PRICING_OVERHAUL_PLAN.md` §8 (v6 골격·수치) + `.claude/state/sprint-credit-overhaul-s-phase-draft.md`.

### 결정 (게이트 6건)
1. **디노미네이션 1:1,000 단일 통화** — 1 크레딧 = 1,000pt. 기존 잔액 ×1,000 자동 환산.
2. **출처 4종 회계 = 1-C 하이브리드** — `Author` 4 필드(`pointsFree`/`pointsSubscription`/`pointsGift`/`pointsCharged`) 잔액 캐시 + `CreditLedger` 입출금 원장. 적립/소진은 $transaction(원장 insert + 캐시 동기).
3. **`credits` 폐기 = 2-C** — `[DEPRECATED]` 표기, 마이그레이션에서 즉시 DROP 안 함(1 sprint 유예 후 별도 sprint 제거 — Cursor 가격개편 반면교사).
4. **구독 = `MembershipPlan` 신설 + `CreditLedger` 통합 (4-C)** — 현행 `Subscription`(독자→작가 팔로우)과 별개 도메인. 월 풀 적립/만료를 `source='subscription'` ledger 의 `expiresAt` 으로 관리 → **이월이 코드 버그로도 불가능**.
5. **채팅 사후 차감 4구간 + `deficit` 외상** — 토큰은 API 응답 후 확정 → 사후 차감. 잔액 부족 시 `Author.deficitPoints` 누적, 충전 시 우선 상계. 경계값·차감 N 은 `SystemSetting` 동적(운영 1~2주 실측 후 재확정). 외상 상한 -10,000pt.
6. **재산정 sensor + 핸드오프 명문화 (6-B)** — `sensor-credit-overhaul-recalc.sh` + researcher/cost-accountant 핸드오프.

### 대안 (거부)
- 이중 통화(옵션 B) — 지갑 2개 UX 복잡 → 거부.
- 출처 4 필드만(1-A) — 회계 입출금 이력 불가 → 거부.
- 구독 풀 이월 차단을 cron 로직에 의존(4-A/4-B) — cron 누락 시 §0 0.14× 붕괴 → 거부(4-C 가 스키마로 강제).

### §0 정합
- 차감 N(채팅 4구간 190/810/3,390/5,520pt, 분석 2,440pt, 테마 590pt)은 전부 cost-accountant v3 스트레스 원가 `ceil(스트레스원가×3 ÷ ₩0.09856)` 산출값 — server Generator 재산출 0건.
- cost-accountant `ai-cost-table.md` 개정 완료(`786b0f3`) — §0 전 항목 ≥3× PASS(경계선 운영, 쿠션 거의 0).
- §8-8 CRITICAL 5건 전건 준수: 비스트레스 차감 0 / 풀 이월 차단(`expiresAt`) / 토큰 실측 필드 선행(`ChatMessage` 5필드) / 채팅 4구간(`xlong` 분리) / 재산정 sensor.

### 결과
- 채팅 가변 비용을 4구간 정액으로 표현 + 출처별 CAC/COGS 분리 + 풀 이월 구조적 차단.
- 신규 모델 2건(`CreditLedger`/`MembershipPlan`) FK `authorId` Restrict(회계·구독 이력 영구 보존, ADR-007 정합).
- jest 신규 162 it (805 → 967).

### 잔존 영역
- 채팅 토큰 P50~P99 실측 — I Phase 배포 후 운영 1~2주 → 구간 경계·N 재확정 (현 경계값은 §8-4 가정).
- `credits` 컬럼 후속 sprint DROP (1 sprint 유예).
- Polar 구독 결제 연동 — 별도 sprint PAY-P1-4 (`MembershipPlan.polarSubscriptionId` 필드만 본 sprint).
- dev migration apply — `크레딧개편 dev migration 진행` 키워드 게이트 (§7 단계6, 본 sprint 범위 밖).
- prod migration — `크레딧개편 prod migration 진행` 키워드 게이트 (§7 단계9).
- 잔액 캐시(`Author` 4필드) ↔ 원장(`CreditLedger`) 정합 cron — PAY-P0-2 `ReconciliationCheckpoint` 패턴 (I Phase 후속).

---

## 참조

- 트랜잭션: `src/application/payment/payment.usecase.ts`
- 동시성: `src/adapter/outbound/persistence/prisma-social.repository.ts`
- N+1 방어: `src/adapter/outbound/persistence/prisma-work.repository.ts`
- 인덱스: `prisma/schema.prisma`
- Docker: `Dockerfile`, `.github/workflows/deploy-*.yml`
- Polar SDK timeout: `src/adapter/outbound/payment/polar.adapter.ts`, `.claude/shared-contracts.md §24 PolarSDKTimeoutPolicy`
- FK Cascade 정책: `prisma/schema.prisma` 33 FK 영역 + `prisma/migrations/20260510_pay_p3_e_fk_cascade_policy/migration.sql` + `.claude/shared-contracts.md §25 FKCascadePolicy`
- audit retention 정책: `prisma/migrations/20260510_pay_p2_5_audit_retention_policy/migration.sql` + `src/adapter/outbound/persistence/audit-mask-helper.ts` + `src/scheduler/audit-mask.scheduler.ts` + `.claude/shared-contracts.md §26 AuditRetentionPolicy`
- Circuit Breaker 정책: `src/domain/model/circuit-breaker-state.ts` + `src/domain/port/outbound/circuit-breaker.port.ts` + `src/adapter/outbound/circuit-breaker/in-memory-circuit-breaker.adapter.ts` + `.claude/shared-contracts.md §27 CircuitBreakerPolicy` + ADR-009
- User Soft Delete 정책: `prisma/schema.prisma` Author.deletedAt + `prisma/migrations/20260515_user_soft_delete_policy/migration.sql` + `src/adapter/outbound/persistence/prisma-soft-delete.middleware.ts` + `src/adapter/outbound/persistence/default-user-anonymizer.adapter.ts` + `src/application/author/user-soft-delete.usecase.ts` + `src/application/author/user-hard-delete.job.ts` + `.claude/shared-contracts.md §29 UserSoftDeletePolicy` + ADR-011
