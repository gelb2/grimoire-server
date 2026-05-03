# MIGRATION.md — 마이그레이션 규칙

> Prisma 마이그레이션 + 데이터 백필 규칙.
> 참조: `SCHEMA.md` (스키마 상세), `INFRASTRUCTURE.md` (환경별 실행), `docs/environments.md` (4단계 환경)

---

## 1. 절대 규칙

- **적용된 마이그레이션 파일은 수정하지 않는다** — 변경이 필요하면 새 마이그레이션을 생성한다
- **스키마 변경은 마이그레이션으로, 데이터 변경은 백필 SQL 또는 API로** — 역할을 섞지 않는다
- **마이그레이션 파일은 git으로 관리한다** — `prisma/migrations/` 폴더 전체가 레포에 포함된다
- **시드 스크립트로 마이그레이션을 대체하지 않는다** — 시드는 localhost 초기 1회 전용

---

## 2. 환경별 실행 방식

| 환경 | 명령어 | 실행 시점 | 비고 |
|------|--------|----------|------|
| localhost | `npx prisma migrate dev` | 개발자가 수동 실행 | 새 마이그레이션 파일 생성 + 즉시 적용 |
| development | `npx prisma migrate deploy` | 컨테이너 시작 시 자동 | `docker-entrypoint.sh`에서 실행 |
| production | `npx prisma migrate deploy` | `RUN_MIGRATION=true` 설정 시에만 | 미설정 시 스킵 (안전 기본값) |

### 환경변수

| 변수 | 값 | 동작 |
|------|-----|------|
| `SKIP_MIGRATION` | `true` | 모든 환경에서 마이그레이션 완전 스킵 |
| `RUN_MIGRATION` | `true` | production에서 마이그레이션 실행 허용 |
| (기본) | - | localhost~development: 자동 실행, production: 스킵 |

---

## 3. 스키마 변경 절차

### 3-1. 새 마이그레이션 생성 (localhost)

```bash
# 1. schema.prisma 수정
# 2. 마이그레이션 생성 + 로컬 DB 적용
npx prisma migrate dev --name {변경_설명}

# 3. 생성된 파일 확인
ls prisma/migrations/
```

### 3-2. 코드 반영

스키마 변경에 맞춰 아래를 함께 수정한다 (같은 커밋):
- `domain/model/` — 도메인 모델
- `domain/port/outbound/` — Repository 인터페이스
- `adapter/outbound/persistence/` — Prisma Repository 구현
- `application/` — UseCase (필요 시)
- `adapter/inbound/http/dto/` — DTO (필요 시)
- `docs/data-model.md` — DB 스키마 문서 (정본)
- `SCHEMA.md` — Prisma 구현 상세

### 3-3. 원격 DB 적용

- development: 코드 push → 컨테이너 재배포 → 자동 적용
- production: 컨테이너 환경변수에 `RUN_MIGRATION=true` 설정 후 배포

### 3-4. 수동 적용 (긴급 시)

```bash
# 방화벽 열기
az postgres flexible-server firewall-rule create \
  --resource-group zenith-rg \
  --name grimoire-db-{env} \
  --rule-name AllowMyIP \
  --start-ip-address {MY_IP} --end-ip-address {MY_IP}

# 마이그레이션 실행
DATABASE_URL="postgresql://grimoireadmin:{PW}@grimoire-db-{env}.postgres.database.azure.com:5432/grimoire?sslmode=require" \
npx prisma migrate deploy

# 방화벽 닫기
az postgres flexible-server firewall-rule delete \
  --resource-group zenith-rg \
  --name grimoire-db-{env} \
  --rule-name AllowMyIP --yes
```

---

## 4. 데이터 백필 규칙

스키마가 아닌 **데이터 내용**을 변경할 때는 마이그레이션이 아닌 백필을 사용한다.

| 방법 | 사용 시점 | 예시 |
|------|----------|------|
| 백필 SQL | 기존 데이터 일괄 수정 | `prisma/seed-descriptions.sql` |
| API | 개별 데이터 수정 | `PATCH /api/works/:id` |
| Prisma 스크립트 | 복잡한 데이터 변환 | `scripts/` 폴더에 일회성 스크립트 |

### 백필 절차

1. SQL 파일 작성 → `prisma/` 또는 `scripts/` 폴더에 보관
2. localhost에서 먼저 실행 + 검증
3. 원격 DB에 방화벽 열고 → psql로 실행 → 방화벽 닫기
4. 실행 완료 후 SQL 파일은 git에 남겨둔다 (이력 추적)

---

## 5. 상태 확인

```bash
# 현재 적용된 마이그레이션 목록 + 미적용 마이그레이션 확인
npx prisma migrate status

# 원격 DB 상태 확인 (방화벽 열린 상태에서)
DATABASE_URL="postgresql://grimoireadmin:{PW}@grimoire-db-{env}.postgres.database.azure.com:5432/grimoire?sslmode=require" \
npx prisma migrate status
```

### 출력 해석

| 상태 | 의미 | 조치 |
|------|------|------|
| `Database schema is up to date!` | 모든 마이그레이션 적용됨 | 없음 |
| `Following migrations have not yet been applied` | 미적용 마이그레이션 존재 | `migrate deploy` 실행 |
| `Following migration(s) are applied to the database but are not listed in the migrations directory` | DB에 존재하지만 파일이 없음 | 마이그레이션 파일 확인 |

---

## 6. 프로덕션 마이그레이션 체크리스트

> 프로덕션(`RUN_MIGRATION=true` 설정 후 배포)은 아래 순서를 반드시 지킨다.

```
[ ] 1. dev(development) 환경에서 동일 마이그레이션이 문제 없이 적용됐는지 확인
[ ] 2. 프로덕션 DB 스냅샷 생성 (Azure Portal → grimoire-db-prod → 백업)
[ ] 3. prisma migrate status 로 현재 상태 확인
[ ] 4. 마이그레이션 실행 (컨테이너 RUN_MIGRATION=true 배포 또는 수동)
[ ] 5. 애플리케이션 기동 정상 확인
[ ] 6. RUN_MIGRATION 환경변수 제거 (다음 배포에서 불필요 재실행 방지)
```

### Azure DB 스냅샷 생성 (수동)

```bash
# 온디맨드 백업 생성
az postgres flexible-server backup create \
  --resource-group zenith-rg \
  --name grimoire-db-prod \
  --backup-name "pre-migration-$(date +%Y%m%d)"

# 백업 목록 확인
az postgres flexible-server backup list \
  --resource-group zenith-rg \
  --name grimoire-db-prod \
  -o table
```

---

## 7. 트러블슈팅

### "permission denied" 오류

```bash
# 원인: DB 사용자 권한 부족
# 확인: psql로 접속 후 권한 확인
psql "postgresql://grimoireadmin:{PW}@grimoire-db-{env}.postgres.database.azure.com:5432/grimoire?sslmode=require" \
  -c "\du grimoireadmin"

# 해결: schema public 권한 부여
psql ... -c "GRANT ALL ON SCHEMA public TO grimoireadmin;"
psql ... -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO grimoireadmin;"
```

### "firewall rule" 접속 오류

```bash
# 원인: 현재 IP가 방화벽에 없음
# 현재 IP 확인
curl -s https://api.ipify.org

# 방화벽 규칙 추가 (INFRASTRUCTURE.md §8 참조)
az postgres flexible-server firewall-rule create ...
```

### 마이그레이션 파일과 DB 불일치

```bash
# 원인: 마이그레이션 파일 없이 DB 직접 수정 등
# 확인
npx prisma migrate status

# 해결: 현재 DB 상태를 기준으로 baseline 설정 (최후 수단)
npx prisma migrate resolve --applied {마이그레이션_이름}
```

---

## 7-Z. 박제 이력: baked_css_url_clear_relative (2026-05-03, P1-#7)

### 목적
`themes.baked_css_url`에 박제된 stale 상대 경로(`/api/themes/css/...`)를 NULL로 정리. 응답 시점에 server가 환경별 `PUBLIC_API_BASE_URL`로 동적 절대화하는 정책으로 전환.

### 변경 내용
- DDL: 없음 (`bakedCssUrl: String?` 이미 NULL 허용 — schema.prisma 변경 0건)
- DML: `UPDATE themes SET baked_css_url = NULL WHERE baked_css_url LIKE '/api/themes/css/%' OR baked_css_url = ''`
- 무중단 OK (DDL 잠금 없음, NULL 일괄 업데이트만)

### 적용 환경
- localhost ✓ (2026-05-03 검증, stale row 0건)
- development: 사용자 명시 후 배포 (다음 배포에서 자동 `migrate deploy`)
- production: 사용자 명시 후 `RUN_MIGRATION=true`로 적용

### 사전 백업 권장
- localhost: 생략
- dev/prod: `pg_dump --table=themes -d {DATABASE} > themes-backup-{ts}.sql` (1MB 미만)

### 롤백 정책
일방향 마이그레이션 (down 미작성). 운영 사고 시 publishTheme 재호출로 자동 재박제됨.
메타만 정리 시 `npx prisma migrate resolve --rolled-back baked_css_url_clear_relative`.

### 관련 환경변수
- `PUBLIC_API_BASE_URL` 필수 (env.validation.ts에서 부팅 시 절대 URL 강제 검증)
  - localhost: `http://localhost:3000/api`
  - development: `https://dev-api.grimoire-book.com/api`
  - production: `https://api.grimoire-book.com/api`

### 관련 코드
- `src/application/theme/bake-theme.usecase.ts` — Blob 비활성/실패 시 NULL 박제
- `src/lib/url-resolver.ts` — 응답 절대화 헬퍼
- `src/adapter/inbound/http/controller/theme.controller.ts` — publish/resolve/findByAuthorSlug 응답 절대화 적용

---

## 7-AA. 박제 이력: add_webhook_event_idempotency (2026-05-03, PAY-P0-1)

### 목적
PG (Polar 등) 웹훅 재전송 시 동일 `event_id`로 두 번째 호출이 들어와도 `completePaymentAtomically`가 단 1회만 실행되도록 멱등성 박제 테이블 신설. **돈은 냈는데 크레딧 두 번 들어가는 사고 0건** 보장.

### 변경 내용
- DDL: `CREATE TABLE webhook_events` + UNIQUE INDEX (`event_id`) + INDEX (`event_type`, `processed_at`)
- DML: 없음 (신규 테이블 — 데이터 backfill 불필요)
- 무중단 OK (기존 테이블 변경 0건)

### 적용 환경
- localhost ✓ (2026-05-03 검증, `\d webhook_events` PASS)
- development: 사용자 명시 후 배포 (다음 배포에서 자동 `migrate deploy`)
- production: 사용자 명시 후 `RUN_MIGRATION=true`로 적용

### 사전 백업 권장
- localhost: 생략
- dev/prod: 신규 테이블만 추가 — 기존 데이터 백업 불필요. 단 안전망으로 `pg_dump --table=payments --data-only > backup-payments-{ts}.sql` 권장.

### 롤백 정책
일방향 마이그레이션 (down 미작성). 운영 사고 시:
- 멱등성 게이트 비활성화: `webhookEventRepo.findByEventId` 결과 무시 패치 (긴급 핫픽스)
- 데이터 정리: `DROP TABLE webhook_events;` (수동, 데이터 손실 허용)

### 핵심 정책
- `event_id` UNIQUE 제약으로 race condition 차단 (Prisma P2002 → safe skip → null 반환)
- Polar `webhook-id` 헤더가 멱등성 키. 헤더 누락 시 어댑터가 null 반환 (안전 거부)
- 처리 결과 박제: 'processed' / 'skipped' (already_completed, unknown_trade) / 'failed' (예외)

### 관련 코드
- `prisma/schema.prisma` — `model WebhookEvent`
- `src/domain/port/outbound/webhook-event-repository.port.ts` — 포트
- `src/adapter/outbound/persistence/prisma-webhook-event.repository.ts` — 어댑터 (P2002 catch)
- `src/application/payment/payment.usecase.ts` — `processWebhook` 멱등성 게이트
- `src/adapter/outbound/payment/polar.adapter.ts` — `webhook-id` 헤더 추출

### 정본
- `.claude/shared-contracts.md` §11 WebhookEventIdempotency
- `reports/sprint-pay-p0-1-webhook-event-id-idempotency-progress.md` (Sprint 단일 진실)

---

## 8. 마이그레이션 변경 이력 문서화

> 마이그레이션 파일(`prisma/migrations/`)은 git이 관리하지만, **왜 변경했는지**는 코드에 남지 않는다.
> 아래 규칙으로 의도를 함께 기록한다.

### 규칙

마이그레이션 생성 시 `CHANGELOG.md`에 다음 형식으로 항목을 추가한다:

```markdown
### DB 마이그레이션: {마이그레이션_이름}
- **목적**: 변경 이유 (예: 에피소드 HWP 포맷 지원 추가)
- **변경 내용**: 컬럼/테이블 추가·수정·삭제 요약
- **롤백 방법**: 역방향 마이그레이션명 또는 "해당 없음"
- **적용 환경**: localhost ✓ / development ✓ / production ✓
```

### 예시

```markdown
### DB 마이그레이션: add_hwp_source_format
- **목적**: HWP 원고 업로드 지원을 위해 source_format에 'hwp' 값 허용
- **변경 내용**: episodes.source_format 컬럼 — check constraint 수정
- **롤백 방법**: rollback_add_hwp_source_format (constraint 원복)
- **적용 환경**: localhost ✓ / development ✓ / production ✓
```

---

## 9. 롤백 가이드

Prisma는 자동 롤백을 지원하지 않는다. 상황별 절차는 다음과 같다.

### 케이스 1 — 마이그레이션이 아직 원격에 배포되지 않은 경우

```bash
# 로컬 DB에만 적용된 경우 → shadow DB 재생성으로 되돌리기
npx prisma migrate reset   # 로컬 DB 초기화 후 처음부터 재적용
# 주의: 로컬 데이터 전체 삭제됨
```

### 케이스 2 — 원격 DB에 이미 배포된 경우

```bash
# 1. 역방향 마이그레이션 생성
#    예: 컬럼 추가 → 컬럼 삭제하는 SQL 작성
npx prisma migrate dev --name rollback_{원래_마이그레이션명}

# 2. 생성된 마이그레이션 파일 내용 확인 + 필요 시 수동 편집
cat prisma/migrations/{timestamp}_rollback_{원래_마이그레이션명}/migration.sql

# 3. 일반 배포와 동일하게 진행
git add prisma/migrations/ && git commit -m "fix: {원래_마이그레이션명} 롤백"
```

### 케이스 3 — 프로덕션 긴급 롤백

> **반드시 사용자 확인 후 진행.**

```bash
# 1. Azure DB 스냅샷 복원 (데이터 포함 완전 복원)
#    Azure Portal → PostgreSQL Flexible Server → 복원
#    또는:
az postgres flexible-server restore \
  --resource-group zenith-rg \
  --name grimoire-db-prod-restored \
  --source-server grimoire-db-prod \
  --restore-time "2026-01-01T12:00:00Z"

# 2. 애플리케이션 코드도 해당 시점으로 revert
git revert {마이그레이션_커밋_SHA}

# 3. 배포 (main → 컨테이너 업데이트)
```

### 롤백 판단 기준

| 상황 | 권장 방법 |
|------|----------|
| 로컬에서만 테스트 중 | `migrate reset` |
| development 환경 | 역방향 마이그레이션 생성 + 배포 |
| production — 데이터 무결성 이상 없음 | 역방향 마이그레이션 생성 + 배포 |
| production — 데이터 손상 발생 | Azure 스냅샷 복원 (사용자 확인 필수) |

---

## 10. 관련 파일

| 파일 | 역할 |
|------|------|
| `prisma/schema.prisma` | 스키마 정의 (단일 진실 공급원) |
| `prisma/migrations/` | 마이그레이션 이력 (git 관리) |
| `docker-entrypoint.sh` | 컨테이너 시작 시 마이그레이션 실행 로직 |
| `SCHEMA.md` | Prisma 스키마 구현 상세 |
| `docs/data-model.md` | DB 스키마 문서 (정본, web에 동기화) |
| `INFRASTRUCTURE.md` §3 | Docker 운영 + 마이그레이션 제어 |
