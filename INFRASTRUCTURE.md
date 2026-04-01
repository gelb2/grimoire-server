# INFRASTRUCTURE.md — grimoire-server

> Azure 인프라 구성 + 운영 명령어.
> 참조: `docs/environments.md` (정본), `SECURITY.md`

---

## 1. Azure 리소스 구성

| 리소스 | 서비스 | 용도 |
|--------|--------|------|
| grimoireacr | Azure Container Registry (Basic) | Docker 이미지 저장소 |
| grimoire-db-{dev/inhouse/prod} | Azure Database for PostgreSQL Flexible (B1ms) | 데이터베이스 |
| zenith-env-dev | Azure Container Apps Environment | 컨테이너 앱 환경 (ProjectZenith 공유) |
| grimoire-server-{dev/inhouse/prod} | Azure Container Apps | API 서버 |
| grimoire-web-{dev/inhouse/prod} | Azure Container Apps | 웹 프론트엔드 |

> 리전: **Korea Central**
> **리소스그룹: `zenith-rg` (유일)** — 모든 Azure 리소스가 이 그룹에 있다. 새 리소스그룹 생성 금지.

---

## 2. 환경별 URL 매핑

| 환경 | Web URL | API URL | DB 서버 |
|------|---------|---------|---------|
| localhost | localhost:3001 | localhost:3000 | Docker 로컬 PostgreSQL (localhost:5432) |
| development | dev.grimoire-book.com | dev-api.grimoire-book.com | grimoire-db-dev |
| inhouse | inhouse.grimoire-book.com | inhouse-api.grimoire-book.com | grimoire-db-inhouse |
| production | grimoire-book.com | api.grimoire-book.com | grimoire-db-prod |

> localhost는 Azure 리소스를 사용하지 않는다. `docker-compose up db`로 로컬 DB를 띄운다.

### 환경별 설정

| 항목 | localhost | development | inhouse | production |
|------|-----------|-------------|---------|------------|
| Swagger | 활성화 | 활성화 | 활성화 | **비활성화** |
| CORS | localhost:3001 | dev.grimoire-book.com | inhouse.grimoire-book.com | grimoire-book.com |
| 로깅 | verbose | verbose | info | warn |
| 마이그레이션 | 자동 | 자동 | 자동 | RUN_MIGRATION=true 필요 |
| 데이터 관리 | 시드 1회 + 마이그레이션/API | 마이그레이션/API만 | 마이그레이션/API만 | 마이그레이션/API만 |
| minReplicas | - | **1** | **1** | **1** |

상세 환경변수는 `docs/environments.md` 참조.

---

## 3. Docker 운영

### 로컬 개발 (docker-compose)

```bash
# 전체 스택 실행 (NestJS + PostgreSQL)
docker-compose up -d

# 인하우스 모드
docker-compose -f docker-compose.yml -f docker-compose.inhouse.yml up -d

# 프로덕션 모드
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 로그 확인
docker-compose logs -f server

# 종료
docker-compose down
```

### 단독 빌드

```bash
docker build -t grimoire-server .
```

### 마이그레이션 제어

> 마이그레이션 규칙 상세: `MIGRATION.md` 참조

| 환경변수 | 값 | 동작 |
|---------|-----|------|
| SKIP_MIGRATION | true | 마이그레이션 완전 스킵 |
| RUN_MIGRATION | true | 프로덕션에서 마이그레이션 실행 허용 |
| (기본) | - | development: 자동 실행, production: 스킵 |

---

## 4. CI/CD 파이프라인

### 워크플로우 구성 (8개)

| 레포 | 워크플로우 | 트리거 | 용도 |
|------|-----------|--------|------|
| server | ci.yml | PR → develop/inhouse/main | 빌드 + 테스트 + Docker 검증 |
| server | deploy-dev.yml | push → develop | 개발 환경 배포 |
| server | deploy-inhouse.yml | push → inhouse | 인하우스 배포 |
| server | deploy-prod.yml | push → main | 프로덕션 배포 |
| web | ci.yml | PR → develop/inhouse/main | 빌드 + 테스트 + E2E |
| web | deploy-dev.yml | push → develop | 개발 환경 배포 |
| web | deploy-inhouse.yml | push → inhouse | 인하우스 배포 |
| web | deploy-prod.yml | push → main | 프로덕션 배포 |

### 배포 흐름

```
develop push → docker build → ACR push → Container Apps 업데이트
inhouse push → docker build → ACR push → Container Apps 업데이트
main push    → docker build → ACR push → Container Apps 업데이트
```

### 이미지 태그 전략

```
grimoireacr.azurecr.io/grimoire-server:{env}-{SHA}
grimoireacr.azurecr.io/grimoire-server:{env}-latest
grimoireacr.azurecr.io/grimoire-web:{env}-{SHA}
grimoireacr.azurecr.io/grimoire-web:{env}-latest
```

---

## 5. GitHub Secrets 설정

| Secret | 용도 |
|--------|------|
| AZURE_CREDENTIALS | Azure 서비스 주체 JSON |
| ACR_LOGIN_SERVER | grimoireacr.azurecr.io |
| ACR_USERNAME | ACR 관리자 사용자명 |
| ACR_PASSWORD | ACR 관리자 비밀번호 |
| DEV_API_URL | 개발 API URL (web 전용) |
| INHOUSE_API_URL | 인하우스 API URL (web 전용) |
| PROD_API_URL | 프로덕션 API URL (web 전용) |

### Azure 서비스 주체 생성

```bash
az ad sp create-for-rbac \
  --name "grimoire-github-actions" \
  --role contributor \
  --scopes /subscriptions/{SUBSCRIPTION_ID}/resourceGroups/zenith-rg \
  --sdk-auth
```

---

## 6. 수동 배포 명령어

### ACR 로그인

```bash
az acr login --name grimoireacr
```

### 수동 빌드 + 푸시 (server)

```bash
docker build -t grimoireacr.azurecr.io/grimoire-server:dev-manual .
docker push grimoireacr.azurecr.io/grimoire-server:dev-manual
az containerapp update \
  --name grimoire-server-dev \
  --resource-group zenith-rg \
  --image grimoireacr.azurecr.io/grimoire-server:dev-manual
```

### 수동 빌드 + 푸시 (web)

```bash
# BFF 패턴: API_URL은 빌드 인자가 아닌 Container Apps 런타임 환경변수로 설정
docker build \
  -t grimoireacr.azurecr.io/grimoire-web:dev-manual .
docker push grimoireacr.azurecr.io/grimoire-web:dev-manual
az containerapp update \
  --name grimoire-web-dev \
  --resource-group zenith-rg \
  --image grimoireacr.azurecr.io/grimoire-web:dev-manual \
  --set-env-vars API_URL=https://grimoire-server-dev.{FQDN}/api
```

---

## 7. 로그 확인

```bash
# 실시간 로그 스트리밍
az containerapp logs show \
  --name grimoire-server-dev \
  --resource-group zenith-rg \
  --follow

# 최근 로그 조회
az containerapp logs show \
  --name grimoire-server-dev \
  --resource-group zenith-rg \
  --tail 100

# 리비전 목록
az containerapp revision list \
  --name grimoire-server-dev \
  --resource-group zenith-rg \
  -o table
```

---

## 8. 방화벽 관리 (마이그레이션용)

```bash
# 로컬 IP에서 DB 접근 허용 (마이그레이션 실행 시)
az postgres flexible-server firewall-rule create \
  --resource-group zenith-rg \
  --name grimoire-db-dev \
  --rule-name AllowMyIP \
  --start-ip-address {MY_IP} \
  --end-ip-address {MY_IP}

# 마이그레이션 실행
DATABASE_URL="postgresql://grimoireadmin:{PW}@grimoire-db-dev.postgres.database.azure.com:5432/grimoire?sslmode=require" \
npx prisma migrate deploy

# 방화벽 규칙 제거 (마이그레이션 완료 후)
az postgres flexible-server firewall-rule delete \
  --resource-group zenith-rg \
  --name grimoire-db-dev \
  --rule-name AllowMyIP \
  --yes
```

---

## 9. 인프라 설정값 현황

> 인프라 설정 변경 시 이 표를 반드시 업데이트한다 (같은 커밋).
> 설정값은 `az` CLI로 확인: `az containerapp show`, `az postgres flexible-server show`

### Container Apps (6개)

| 앱 | CPU | 메모리 | minReplicas | maxReplicas | 포트 | 커스텀 도메인 | SSL |
|----|-----|--------|-------------|-------------|------|-------------|-----|
| web-dev | 0.5 | 1Gi | 1 | 1 | 3001 | dev.grimoire-book.com | ✅ |
| server-dev | 0.5 | 1Gi | 1 | 1 | 3000 | dev-api.grimoire-book.com | ✅ |
| web-inhouse | 0.5 | 1Gi | 1 | 1 | 3001 | inhouse.grimoire-book.com | ✅ |
| server-inhouse | 0.5 | 1Gi | 1 | 1 | 3000 | inhouse-api.grimoire-book.com | ✅ |
| web-prod | 0.5 | 1Gi | 1 | 1 | 3001 | grimoire-book.com | ✅ |
| server-prod | 0.5 | 1Gi | 1 | 1 | 3000 | api.grimoire-book.com | ✅ |

### PostgreSQL (3개)

| DB | SKU | 스토리지 | autoGrow | 백업 | HA | Geo백업 |
|----|-----|---------|----------|------|-----|---------|
| db-dev | B1ms (1 vCore, 2GB) | 32GB | 꺼짐 | 7일 | 꺼짐 | 꺼짐 |
| db-inhouse | B1ms (1 vCore, 2GB) | 32GB | 꺼짐 | 7일 | 꺼짐 | 꺼짐 |
| db-prod | B1ms (1 vCore, 2GB) | 32GB | 꺼짐 | 7일 | 꺼짐 | 꺼짐 |

> 백업 7일: 지난 7일 내 아무 시점으로 복원 가능 (Point-in-Time Restore). 자동 동작.
> HA (고가용성): DB 2대 자동 전환. 현재 꺼짐 — 장애 시 수 분 다운타임 발생. 비용 2배이므로 트래픽 증가 시 검토.
> autoGrow: 스토리지 자동 확장. 꺼짐 — 32GB 고정. 비용 폭탄 방지.

### Container Registry

| 항목 | 값 |
|------|-----|
| SKU | Basic ($5/월, 10GB 포함) |
| 이미지 정리 | 꺼짐 — 수동 정리 필요 |

### 예산 알림

| 예산 | 금액 | 알림 |
|------|------|------|
| grimoire-monthly-100 | $100/월 | 50%/80%/100% → hiphopxy@naver.com |

### 월 비용 추정

| 리소스 | 단가 | 수량 | 월 비용 |
|--------|------|------|---------|
| PostgreSQL B1ms + 32GB | ~$16/월 | 3 | ~$48 |
| Container Apps (min=1, 0.5vCPU) | ~$5/월 | 6 | ~$30 |
| Container Registry Basic | $5/월 | 1 | $5 |
| 도메인 (grimoire-book.com) | $0.87/월 | 1 | ~$1 |
| **합계** | | | **~$84/월** |

> 비용 폭탄 방지: maxReplicas=1 (자동 확장 없음) + autoGrow=Disabled (스토리지 고정) + 예산 알림 $100

---

## 10. DB 동기화 정책

> 운영 데이터를 하위 환경으로 동기화하여 테스트 데이터 정합성을 확보한다.

### 동기화 흐름

```
prod ──→ inhouse (PII 유지, 내부 QA용)
prod ──→ dev     (PII 마스킹)
dev  ──→ local   (수동, 이미 마스킹된 데이터)
```

### 자동 동기화 (GitHub Actions)

| 항목 | 값 |
|------|-----|
| 워크플로우 | `.github/workflows/db-sync-nightly.yml` |
| 스케줄 | 매일 자정 KST (UTC 15:00) |
| 수동 트리거 | `workflow_dispatch` (source/target/mask 선택) |
| 필요 시크릿 | `DB_PASSWORD`, `AZURE_CREDENTIALS` |

### PII 마스킹 정책

| 대상 → | inhouse | dev | local |
|--------|:-------:|:---:|:-----:|
| email | 유지 | 마스킹 | 마스킹 |
| passwordHash | 유지 | 마스킹 | 마스킹 |
| providerEmail | 유지 | 마스킹 | 마스킹 |

마스킹 형식: `author-{n}@masked.local`, 고정 bcrypt 해시

### localhost 동기화 (수동)

```bash
# Docker DB 실행 중이어야 함
./scripts/db-sync-local.sh
```

### 방화벽 처리

- 동기화 시작 시 러너 IP를 임시 방화벽 규칙으로 추가
- 동기화 완료 후 (실패 포함) 반드시 제거 (`if: always()` / `trap EXIT`)
- 규칙명: `github-actions-sync` (자동) / `temp-local-sync` (수동)

### 스크립트

| 스크립트 | 용도 |
|---------|------|
| `scripts/db-sync.ts` | 데이터 동기화 (Prisma 기반, PII 마스킹 지원) |
| `scripts/db-sync-local.sh` | dev → localhost 동기화 (방화벽 자동 관리) |

---

## 11. Cloudflare DNS 설정 가이드

### CNAME 레코드 설정

| 레코드 | 이름 | 대상 |
|--------|------|------|
| CNAME | grimoire-book.com | grimoire-web-prod.{FQDN} |
| CNAME | dev.grimoire-book.com | grimoire-web-dev.{FQDN} |
| CNAME | inhouse.grimoire-book.com | grimoire-web-inhouse.{FQDN} |
| CNAME | api.grimoire-book.com | grimoire-server-prod.{FQDN} |
| CNAME | dev-api.grimoire-book.com | grimoire-server-dev.{FQDN} |
| CNAME | inhouse-api.grimoire-book.com | grimoire-server-inhouse.{FQDN} |

> FQDN은 Azure Container Apps 생성 후 확인 가능:
> ```bash
> az containerapp show --name grimoire-server-prod --resource-group zenith-rg --query "properties.configuration.ingress.fqdn" -o tsv
> ```

### SSL 설정

- Cloudflare SSL: Full (strict)
- Azure Container Apps: 자동 HTTPS 인증서

---

## 12. 초기 세팅

```bash
# Azure 리소스 일괄 생성
chmod +x scripts/azure-setup.sh
./scripts/azure-setup.sh
```

상세: `scripts/azure-setup.sh` 참조.

---

## 13. 참조 문서

- `docs/environments.md` — 빌드 환경 + 배포 전략 (정본)
- `SECURITY.md` — 보안 정책 + 배포 전 체크리스트
- `TECH_STATUS.md` — 현재 구현 상태
