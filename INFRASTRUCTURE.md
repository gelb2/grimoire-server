# INFRASTRUCTURE.md — grimoire-server

> Azure 인프라 구성 + 운영 명령어.
> 참조: `docs/environments.md` (정본), `SECURITY.md`

---

## 1. Azure 리소스 구성

| 리소스 | 서비스 | 용도 |
|--------|--------|------|
| grimoire-rg | Resource Group | 전체 리소스 그룹 |
| grimoireacr | Azure Container Registry (Basic) | Docker 이미지 저장소 |
| grimoire-db-{dev/inhouse/prod} | Azure Database for PostgreSQL Flexible (B1ms) | 데이터베이스 |
| grimoire-env | Azure Container Apps Environment | 컨테이너 앱 환경 |
| grimoire-server-{dev/inhouse/prod} | Azure Container Apps | API 서버 |
| grimoire-web-{dev/inhouse/prod} | Azure Container Apps | 웹 프론트엔드 |

> 리전: **Korea Central**

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
  --scopes /subscriptions/{SUBSCRIPTION_ID}/resourceGroups/grimoire-rg \
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
  --resource-group grimoire-rg \
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
  --resource-group grimoire-rg \
  --image grimoireacr.azurecr.io/grimoire-web:dev-manual \
  --set-env-vars API_URL=https://grimoire-server-dev.{FQDN}/api
```

---

## 7. 로그 확인

```bash
# 실시간 로그 스트리밍
az containerapp logs show \
  --name grimoire-server-dev \
  --resource-group grimoire-rg \
  --follow

# 최근 로그 조회
az containerapp logs show \
  --name grimoire-server-dev \
  --resource-group grimoire-rg \
  --tail 100

# 리비전 목록
az containerapp revision list \
  --name grimoire-server-dev \
  --resource-group grimoire-rg \
  -o table
```

---

## 8. 방화벽 관리 (마이그레이션용)

```bash
# 로컬 IP에서 DB 접근 허용 (마이그레이션 실행 시)
az postgres flexible-server firewall-rule create \
  --resource-group grimoire-rg \
  --name grimoire-db-dev \
  --rule-name AllowMyIP \
  --start-ip-address {MY_IP} \
  --end-ip-address {MY_IP}

# 마이그레이션 실행
DATABASE_URL="postgresql://grimoireadmin:{PW}@grimoire-db-dev.postgres.database.azure.com:5432/grimoire?sslmode=require" \
npx prisma migrate deploy

# 방화벽 규칙 제거 (마이그레이션 완료 후)
az postgres flexible-server firewall-rule delete \
  --resource-group grimoire-rg \
  --name grimoire-db-dev \
  --rule-name AllowMyIP \
  --yes
```

---

## 9. 비용 예측

| 리소스 | 단가 | 수량 | 월 비용 |
|--------|------|------|---------|
| PostgreSQL B1ms | ~$12/월 | 3 | ~$36 |
| Container Apps | 사용량 기반 | 6 | ~$3-5 |
| Container Registry Basic | $5/월 | 1 | $5 |
| **합계** | | | **~$44-46/월** |

> 예산 알림: $50/월 설정 (`az consumption budget`)

---

## 10. Cloudflare DNS 설정 가이드

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
> az containerapp show --name grimoire-server-prod --resource-group grimoire-rg --query "properties.configuration.ingress.fqdn" -o tsv
> ```

### SSL 설정

- Cloudflare SSL: Full (strict)
- Azure Container Apps: 자동 HTTPS 인증서

---

## 11. 초기 세팅

```bash
# Azure 리소스 일괄 생성
chmod +x scripts/azure-setup.sh
./scripts/azure-setup.sh
```

상세: `scripts/azure-setup.sh` 참조.

---

## 12. 참조 문서

- `docs/environments.md` — 빌드 환경 + 배포 전략 (정본)
- `SECURITY.md` — 보안 정책 + 배포 전 체크리스트
- `TECH_STATUS.md` — 현재 구현 상태
