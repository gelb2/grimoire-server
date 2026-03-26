# INFRASTRUCTURE.md — grimoire-server

> Azure 인프라 구성 + 운영 명령어.
> 참조: `docs/environments.md` (정본), `SECURITY.md`

---

## 1. Azure 리소스 구성

| 리소스 | 서비스 | 용도 |
|--------|--------|------|
| grimoire-server-{env} | Azure Container Apps | API 서버 |
| grimoire-db-{env} | Azure Database for PostgreSQL | 데이터베이스 |
| grimoire-acr | Azure Container Registry | Docker 이미지 저장소 |

> Phase 1에서는 로컬 개발만 사용. Azure 리소스는 Phase 2 배포 시 생성 예정.

---

## 2. 환경별 구성

| 항목 | development | inhouse | production |
|------|-------------|---------|------------|
| API URL | localhost:3000 | inhouse-api.grimoire.app | api.grimoire.app |
| DB | Docker/로컬 PostgreSQL | Azure PostgreSQL | Azure PostgreSQL |
| Swagger | 활성화 | 활성화 | **비활성화** |
| CORS | localhost:* | inhouse.grimoire.app | grimoire.app |
| 로깅 | verbose | info | warn |

상세 환경변수는 `docs/environments.md` 참조.

---

## 3. Docker 운영

### 빌드

```bash
docker build -t grimoire-server .
```

### 로컬 실행 (PostgreSQL 포함)

```bash
# PostgreSQL 컨테이너
docker run -d --name grimoire-db \
  -e POSTGRES_USER=grimoire \
  -e POSTGRES_PASSWORD=REMOVED_CREDENTIAL_016 \
  -e POSTGRES_DB=grimoire \
  -p 5432:5432 \
  postgres:16-alpine

# 서버 컨테이너
docker run -d --name grimoire-server \
  -e DATABASE_URL=postgresql://grimoire:REMOVED_CREDENTIAL_016@host.docker.internal:5432/grimoire \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e CORS_ORIGIN=http://localhost:3001 \
  -e RUN_MIGRATION=true \
  -p 3000:3000 \
  grimoire-server
```

### 마이그레이션 제어

| 환경변수 | 값 | 동작 |
|---------|-----|------|
| SKIP_MIGRATION | true | 마이그레이션 완전 스킵 |
| RUN_MIGRATION | true | 프로덕션에서 마이그레이션 실행 허용 |
| (기본) | - | development: 자동 실행, production: 스킵 |

---

## 4. CI/CD 파이프라인 (Phase 2 예정)

```
develop push → build:dev → Azure Container Apps (grimoire-server-dev)
inhouse push → build:inhouse → Azure Container Apps (grimoire-server-inhouse)
main push → build:prod → Azure Container Apps (grimoire-server-prod)
```

`.github/workflows/` 참조.

---

## 5. 참조 문서

- `docs/environments.md` — 빌드 환경 + 배포 전략 (정본)
- `SECURITY.md` — 보안 정책 + 배포 전 체크리스트
- `TECH_STATUS.md` — 현재 구현 상태
