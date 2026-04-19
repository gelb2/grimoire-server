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

## 참조

- 트랜잭션: `src/application/payment/payment.usecase.ts`
- 동시성: `src/adapter/outbound/persistence/prisma-social.repository.ts`
- N+1 방어: `src/adapter/outbound/persistence/prisma-work.repository.ts`
- 인덱스: `prisma/schema.prisma`
- Docker: `Dockerfile`, `.github/workflows/deploy-*.yml`
