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

### 검토한 대안
- **2PC (Two-Phase Commit)**: 분산 DB에서 필요하지만, 단일 PostgreSQL이므로 과도함
- **Saga 패턴**: 마이크로서비스 간 트랜잭션에 적합하지만, 모놀리스에서는 복잡성만 증가
- **Event Sourcing**: 추적성은 좋지만 현재 규모에서는 오버엔지니어링

### 한계
현재는 단일 DB이므로 `$transaction`으로 충분하지만, DB가 분산되면 Saga 패턴 도입 필요.

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

### 검토한 대안
- **SELECT ... FOR UPDATE**: 명시적 비관적 락. 현재 규모에서는 불필요
- **Optimistic Locking (version 필드)**: 충돌 빈도가 높으면 재시도 오버헤드
- **Redis 분산 락**: 다중 인스턴스 환경에서 필요하지만, 현재 단일 인스턴스

### 한계
Container Apps max-replicas가 1이라 현재는 안전. 수평 확장 시 Redis 락 검토 필요.

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

### 검토한 대안
- **Raw SQL JOIN**: Prisma가 생성하는 쿼리 품질이 충분하고, 타입 안전성 유지
- **DataLoader 패턴**: GraphQL에서는 필수지만, REST API + Prisma에서는 include가 더 단순
- **Materialized View**: 읽기 성능은 좋지만 쓰기 복잡성 증가

### 검증
Prisma의 `include`는 내부적으로 JOIN 또는 별도 쿼리를 생성하지만, `_count`는 서브쿼리로 최적화됨. 현재 규모(100개 미만 작품)에서 성능 문제 없음.

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

### 검토한 대안
- **Cursor-based 페이지네이션**: 대규모 데이터에서는 offset보다 효율적이지만, 현재 규모에서는 offset으로 충분
- **전문 검색 (Full-Text Search)**: 작가 검색에 PostgreSQL `ILIKE`를 사용 중. 데이터 증가 시 `pg_trgm` 또는 Elasticsearch 검토

### 모니터링 방법
```sql
EXPLAIN ANALYZE SELECT * FROM works ORDER BY view_count DESC LIMIT 12;
```
PostgreSQL의 실행 계획으로 인덱스 사용 여부 확인.

---

## ADR-005: 도커라이징과 배포

### 결정
Docker 멀티스테이지 빌드로 단일 이미지를 만들고, 환경변수만 바꿔서 3환경(dev/inhouse/prod) 배포.

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
inhouse → 같은 이미지 → Container Apps update (inhouse)
main → 같은 이미지 → Container Apps update (prod)
```

### 검토한 대안
- **환경별 별도 이미지**: 환경마다 다른 빌드 → 이미지 불일치 위험
- **Kubernetes**: 오케스트레이션 필요하지만, 현재 규모에서는 Container Apps로 충분
- **Serverless (Azure Functions)**: NestJS와 호환성 낮음, Cold Start 문제

### 무중단 배포
Azure Container Apps가 Rolling Update를 기본 지원. 새 리비전이 헬스체크 통과 후 기존 리비전을 교체.

---

## 참조

- 트랜잭션: `src/application/payment/payment.usecase.ts`
- 동시성: `src/adapter/outbound/persistence/prisma-social.repository.ts`
- N+1 방어: `src/adapter/outbound/persistence/prisma-work.repository.ts`
- 인덱스: `prisma/schema.prisma`
- Docker: `Dockerfile`, `.github/workflows/deploy-*.yml`
