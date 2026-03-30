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
| inhouse | `npx prisma migrate deploy` | 컨테이너 시작 시 자동 | `docker-entrypoint.sh`에서 실행 |
| production | `npx prisma migrate deploy` | `RUN_MIGRATION=true` 설정 시에만 | 미설정 시 스킵 (안전 기본값) |

### 환경변수

| 변수 | 값 | 동작 |
|------|-----|------|
| `SKIP_MIGRATION` | `true` | 모든 환경에서 마이그레이션 완전 스킵 |
| `RUN_MIGRATION` | `true` | production에서 마이그레이션 실행 허용 |
| (기본) | - | localhost~inhouse: 자동 실행, production: 스킵 |

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

- development/inhouse: 코드 push → 컨테이너 재배포 → 자동 적용
- production: 컨테이너 환경변수에 `RUN_MIGRATION=true` 설정 후 배포

### 3-4. 수동 적용 (긴급 시)

```bash
# 방화벽 열기
az postgres flexible-server firewall-rule create \
  --resource-group grimoire-rg \
  --name grimoire-db-{env} \
  --rule-name AllowMyIP \
  --start-ip-address {MY_IP} --end-ip-address {MY_IP}

# 마이그레이션 실행
DATABASE_URL="postgresql://grimoireadmin:{PW}@grimoire-db-{env}.postgres.database.azure.com:5432/grimoire?sslmode=require" \
npx prisma migrate deploy

# 방화벽 닫기
az postgres flexible-server firewall-rule delete \
  --resource-group grimoire-rg \
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
[ ] 1. inhouse 환경에서 동일 마이그레이션이 문제 없이 적용됐는지 확인
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
  --resource-group grimoire-rg \
  --name grimoire-db-prod \
  --backup-name "pre-migration-$(date +%Y%m%d)"

# 백업 목록 확인
az postgres flexible-server backup list \
  --resource-group grimoire-rg \
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

## 8. 롤백

Prisma는 자동 롤백을 지원하지 않는다. 롤백이 필요하면:

1. 역방향 마이그레이션을 새로 생성한다 (예: 컬럼 추가 → 컬럼 삭제)
2. `prisma migrate dev --name rollback_{원래_마이그레이션명}`
3. 일반 마이그레이션과 동일하게 배포

> production 롤백은 반드시 사용자 확인 후 진행한다.

---

## 9. 관련 파일

| 파일 | 역할 |
|------|------|
| `prisma/schema.prisma` | 스키마 정의 (단일 진실 공급원) |
| `prisma/migrations/` | 마이그레이션 이력 (git 관리) |
| `docker-entrypoint.sh` | 컨테이너 시작 시 마이그레이션 실행 로직 |
| `SCHEMA.md` | Prisma 스키마 구현 상세 |
| `docs/data-model.md` | DB 스키마 문서 (정본, web에 동기화) |
| `INFRASTRUCTURE.md` §3 | Docker 운영 + 마이그레이션 제어 |
