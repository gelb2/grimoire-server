# INFRASTRUCTURE.md — grimoire-server

> Azure 인프라 구성 + 운영 명령어.
> 참조: `docs/environments.md` (정본), `SECURITY.md`
>
> **2026-04-19: `inhouse` 환경 제거 (3환경 → 2환경).** QA는 dev에서 develop 브랜치로 수행.
> Container App 4개 (server/web × dev/prod) 전부 `min-replicas=0, cpu=0.25, memory=0.5Gi`로 복원 완료.

---

## 1. Azure 리소스 구성

| 리소스 | 서비스 | 용도 |
|--------|--------|------|
| grimoireacr | Azure Container Registry (Basic) | Docker 이미지 저장소 |
| grimoire-db-{dev/prod} | Azure Database for PostgreSQL Flexible (B1ms) | 데이터베이스 |
| zenith-env-dev | Azure Container Apps Environment | 컨테이너 앱 환경 (ProjectZenith 공유) |
| grimoire-server-{dev/prod} | Azure Container Apps | API 서버 |
| grimoire-web-{dev/prod} | Azure Container Apps | 웹 프론트엔드 |
| grimoire0storage | Azure Blob Storage (Standard_LRS) | 커버 이미지 + 테마 CSS CDN |

> 리전: **Korea Central**
> **리소스그룹: `zenith-rg` (유일)** — 모든 Azure 리소스가 이 그룹에 있다. 새 리소스그룹 생성 금지.

---

## 2. 환경별 URL 매핑

| 환경 | Web URL | API URL | DB 서버 |
|------|---------|---------|---------|
| localhost | localhost:3001 | localhost:3000 | Docker 로컬 PostgreSQL (localhost:5432) |
| development | dev.grimoire-book.com | dev-api.grimoire-book.com | grimoire-db-dev |
| production | grimoire-book.com | api.grimoire-book.com | grimoire-db-prod |

> localhost는 Azure 리소스를 사용하지 않는다. `docker-compose up db`로 로컬 DB를 띄운다.

### 환경별 설정

| 항목 | localhost | development | production |
|------|-----------|-------------|------------|
| Swagger | 활성화 | 활성화 | **비활성화** |
| CORS | localhost:3001 | dev.grimoire-book.com (+ `*` 허용) | grimoire-book.com |
| 로깅 | verbose | verbose | warn |
| 마이그레이션 | 자동 | 자동 | RUN_MIGRATION=true 필요 |
| 데이터 관리 | 시드 1회 + 마이그레이션/API | 마이그레이션/API만 | 마이그레이션/API만 |
| minReplicas | - | **0** | **0** |
| CPU / Memory | - | 0.25 vCPU / 0.5Gi | 0.25 vCPU / 0.5Gi |

상세 환경변수는 `docs/environments.md` 참조.

---

## 3. Docker 운영

### 로컬 개발 (docker-compose)

```bash
# 전체 스택 실행 (NestJS + PostgreSQL)
docker-compose up -d

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

### 워크플로우 구성 (2026-04-19 inhouse 제거 후)

| 레포 | 워크플로우 | 트리거 | 용도 |
|------|-----------|--------|------|
| server | ci.yml | PR → develop/main | 빌드 + 테스트 + Docker 검증 |
| server | deploy-dev.yml | push → develop | 개발 환경 배포 |
| server | deploy-prod.yml | push → main | 프로덕션 배포 |
| web | ci.yml | PR → develop/main | 빌드 + 테스트 + E2E |
| web | deploy-dev.yml | push → develop | 개발 환경 배포 |
| web | deploy-prod.yml | push → main | 프로덕션 배포 |

> GitHub Actions는 빌링 문제로 현재 차단 상태. 수동 배포가 1차 수단 — `docs/DEPLOY.md` 참조.

### 배포 흐름

```
develop push → docker build → ACR push → Container Apps 업데이트
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

## 6. 수동 배포

> **정본: [`docs/DEPLOY.md`](docs/DEPLOY.md)** — 환경 매트릭스, preflight 전수검사, 2환경 배포 절차, 롤백 방법이 전부 거기 있다.
> 2026-04-18부터 수동 배포가 1차 수단이 되었고, Makefile + scripts/로 체계화되었다.

### 빠른 참조

```bash
cd grimoire-server
make help                        # 전체 타겟 목록
make preflight ENV=dev           # 배포 전 전수검사만
make deploy-dev                  # dev 배포 (preflight + build + push + update + healthcheck)
make deploy-prod                 # prod 배포 (interactive 'yes' 확인 필수)
make logs ENV=dev                # Container App 로그 tail
make rollback ENV=prod SHA=<full-sha>   # 과거 이미지로 되돌림
```

web 레포도 동일한 Makefile 인터페이스를 가진다.

### 주의사항

1. **`:latest` 태그 사용 금지** — 반드시 `{env}-{SHA}` 태그로 배포한다. (스크립트가 자동 적용)
2. **docs/DEPLOY.md §1 환경 매트릭스가 유일한 진실**. 환경변수/URL/태그 규칙 변경 시 그 표를 먼저 갱신한다.
3. **GitHub Actions와 수동 배포는 동일 로직**이어야 한다. CI YAML을 고치면 scripts도 함께 고친다 (혹은 반대로).
4. **prod 배포는 interactive 'yes' 입력** 없이는 진행되지 않는다 (preflight §8).

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

### 7-A. Cron 모니터링 — PaymentReconciliationJob (PAY-P0-2, 2026-05-03)

10분 주기 cron이 정상 동작 중인지 Container Apps 로그에서 확인:

```bash
# PaymentReconciliationJob 로그 필터 (10분 주기 PG↔DB 정합성 검증)
az containerapp logs show \
  --name grimoire-server-dev \
  --resource-group zenith-rg \
  --tail 200 \
  | grep "PaymentReconciliationJob"

# 기대 로그 패턴 (정상 동작):
# [PaymentReconciliationJob] PaymentReconciliationJob 시작 — since=2026-05-03T...
# [PaymentReconciliationJob] PaymentReconciliationJob 완료 — processed=N boost=N mismatch=N expire=N
#
# 보정 발생 로그:
# [PaymentReconciliationJob] [boost] paymentId=... credits=N authorId=...
# [PaymentReconciliationJob] [refund_mismatch] paymentId=... PG=refunded DB=completed (수동 환수 필요)
# [PaymentReconciliationJob] [expire] paymentId=... pending 24h 경과 만료 처리
#
# 예외 발생 로그 (운영자 즉시 점검):
# [PaymentReconciliationJob] PaymentReconciliationJob 예외 — ...
# [PaymentReconciliationJob] Polar list API 호출 실패 — ...
```

**cron 비활성화 (긴급 핫픽스)**:
```bash
# Container Apps 환경변수 추가 — 즉시 cron 진입 시 return
az containerapp update \
  --name grimoire-server-dev \
  --resource-group zenith-rg \
  --set-env-vars RECONCILIATION_DISABLED=1
```

**replicas 정책**:
- 현재 replicas=1 가정 (Container Apps 기본 설정). 같은 process 내 in-memory `isRunning` lock으로 동시 실행 차단.
- replicas ≥2 시점에는 `pg_try_advisory_lock` 보강 필요 (PAY-P1).

### 7-B. Cron 모니터링 — PaymentCleanupJob (PAY-P1-3, 2026-05-04)

매일 새벽 4시 cron으로 24h 초과 pending Payment 'expired' 마킹. PAY-P0-2 reconciliation cron(10분 주기)이 처리하지 못하는 PG 미진입 row 추가 정리.

```bash
# PaymentCleanupJob 로그 필터 (매일 새벽 4시 cron)
az containerapp logs show \
  --name grimoire-server-dev \
  --resource-group zenith-rg \
  --tail 200 \
  | grep "PaymentCleanupJob"

# 기대 로그 패턴 (정상 동작):
# [PaymentCleanupJob] PaymentCleanupJob 시작 — startedAt=2026-05-05T04:00:00.000Z expireHours=24
# [PaymentCleanupJob] PaymentCleanupJob 완료 — expireCount=N stalePendingCount=N
# [PaymentCleanupJob] [cleanup] paymentId=... authorId=... elapsed=Nh → expired
#
# 비활성화 / 동시 실행 차단 로그:
# [PaymentCleanupJob] PAYMENT_CLEANUP_DISABLED=1 — cleanup cron 비활성화 (skip)
# [PaymentCleanupJob] PaymentCleanupJob 이미 실행 중 — 동시 실행 차단 (skip)
#
# 개별 row 실패 로그 (resilient — 다음 row 처리 계속):
# [PaymentCleanupJob] [cleanup] paymentId=... expire 실패 — ...
```

**cron 비활성화 (긴급 핫픽스)**:
```bash
az containerapp update \
  --name grimoire-server-dev \
  --resource-group zenith-rg \
  --set-env-vars PAYMENT_CLEANUP_DISABLED=1
```

**시간대 정합**:
- PAY-P0-2 reconciliation: 새벽 3시 + 10분 주기
- PAY-P1-3 cleanup: 새벽 4시 1회만 (시간대/주기 분리, 동시 발동 방지)

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

## 9. 인프라 설정값 현황 (2026-04-19 기준)

> 인프라 설정 변경 시 이 표를 반드시 업데이트한다 (같은 커밋).
> 설정값은 `az` CLI로 확인: `az containerapp show`, `az postgres flexible-server show`

### Container Apps (4개)

| 앱 | CPU | 메모리 | minReplicas | maxReplicas | 포트 | 커스텀 도메인 | SSL |
|----|-----|--------|-------------|-------------|------|-------------|-----|
| web-dev | 0.25 | 0.5Gi | 0 | 1 | 3001 | dev.grimoire-book.com | ✅ |
| server-dev | 0.25 | 0.5Gi | 0 | 1 | 3000 | dev-api.grimoire-book.com | ✅ |
| web-prod | 0.25 | 0.5Gi | 0 | 1 | 3001 | grimoire-book.com | ✅ |
| server-prod | 0.25 | 0.5Gi | 0 | 1 | 3000 | api.grimoire-book.com | ✅ |

> `min-replicas=0` 정책: idle 시 컨테이너가 완전 꺼짐. 첫 요청 시 cold start 10~30초 있음 — Cloudflare edge SSR 캐시로 대다수 영향 최소화.

### PostgreSQL (2개)

| DB | SKU | 스토리지 | autoGrow | 백업 | HA | Geo백업 |
|----|-----|---------|----------|------|-----|---------|
| db-dev | B1ms (1 vCore, 2GB) | 32GB | 꺼짐 | 7일 | 꺼짐 | 꺼짐 |
| db-prod | B1ms (1 vCore, 2GB) | 32GB | 꺼짐 | 7일 | 꺼짐 | 꺼짐 |

> 백업 7일: 지난 7일 내 아무 시점으로 복원 가능 (Point-in-Time Restore). 자동 동작.
> HA (고가용성): DB 2대 자동 전환. 현재 꺼짐 — 장애 시 수 분 다운타임 발생. 비용 2배이므로 트래픽 증가 시 검토.
> autoGrow: 스토리지 자동 확장. 꺼짐 — 32GB 고정. 비용 폭탄 방지.

### Container Registry

| 항목 | 값 |
|------|-----|
| SKU | Basic ($5/월, 10GB 포함) |
| 이미지 정리 | 꺼짐 — 배포 스크립트가 `{env}-` prefix별 최근 5개만 유지 (purge) |

### 예산 알림

| 예산 | 금액 | 알림 |
|------|------|------|
| grimoire-monthly | 사용자 설정 | Azure Portal → Cost Management |

### 월 비용 추정 (2026-04-19 재계산)

| 리소스 | 수량 | 월 비용 추정 |
|--------|------|---------|
| PostgreSQL B1ms + 32GB | 2 | ~₩47,000 |
| Container Apps (min=0, 0.25vCPU, 0.5Gi) | 4 | ~₩15,000 (idle 비용 거의 0) |
| Container Registry Basic | 1 | ~₩7,000 |
| Blob Storage | 1 | ~₩3,000 |
| Log Analytics | - | ~₩5,000 |
| Bandwidth | - | ~₩2,000 |
| **합계** | | **~₩73,000/월** |

> 비용 폭탄 방지: maxReplicas=1 (자동 확장 없음) + autoGrow=Disabled (스토리지 고정).
> 실측은 다음 달 Cost Management + Billing에서 확인.

---

## 10. DB 동기화 정책

> 운영 데이터를 하위 환경으로 동기화하여 테스트 데이터 정합성을 확보한다.

### 동기화 흐름 (2026-04-19 inhouse 제거 후)

```
prod ──→ dev     (PII 마스킹)
dev  ──→ local   (수동, 이미 마스킹된 데이터)
```

### 자동 동기화 (GitHub Actions) — 2026-05-27 GCP 영역 정합

| 항목 | 값 |
|------|-----|
| 워크플로우 | `.github/workflows/db-sync-nightly.yml` |
| 스케줄 | 매일 자정 KST (UTC 15:00) |
| 수동 트리거 | `workflow_dispatch` (source/target/mask 선택) |
| 필요 시크릿 | `GCP_SA_KEY` (GCP 인증), `DB_PASSWORD_PROD`, `DB_PASSWORD_DEV` (Cloud SQL 영역 분리 강제) |
| 인증 방식 | google-github-actions/auth@v2 (SA Key JSON) |
| DB 연결 | Cloud SQL Auth Proxy v2.13.0 (source=127.0.0.1:5432, target=127.0.0.1:5433) |
| Cloud SQL 영역 | `grimoire-491708:asia-northeast1:grimoire-db-{prod\|dev}` |

### PII 마스킹 정책

| 대상 → | dev | local |
|--------|:---:|:-----:|
| email | 마스킹 | 마스킹 |
| passwordHash | 마스킹 | 마스킹 |
| providerEmail | 마스킹 | 마스킹 |

마스킹 형식: `author-{n}@masked.local`, 고정 bcrypt 해시

### 수동 동기화 (비상용 + 즉시 실행 필요 시)

`docs/DEPLOY.md §8` 원칙 "수동 실행은 긴급 수단으로 계속 유지. 스크립트가 정본, CI는 래퍼"를 DB 동기화에도 동일 적용.

#### Makefile 진입점 (2026-05-27 GCP 영역 정합)

```bash
# prod 관련은 interactive 'yes' 확인 프롬프트 있음 (CI에선 SKIP_INTERACTIVE=1)
export DB_PASSWORD_PROD='...'   # prod Cloud SQL 영역
export DB_PASSWORD_DEV='...'    # dev Cloud SQL 영역
gcloud auth login              # 선행 (project=grimoire-491708 영역 정합)
gcloud config set project grimoire-491708

make db-sync-prod-to-dev         # prod → dev (PII 마스킹)
make db-sync-dev-to-local        # dev → localhost (Docker DB 필요)
```

#### 동작 순서 (scripts/db-sync-remote.sh)

1. **입력 검증**: SOURCE/TARGET 유효성 + 방향 검증 (하위→상위 금지)
2. **preflight**: `DB_PASSWORD_{ENV}` 환경변수 영역 + `gcloud auth` 영역 + project 영역 정합 + Prisma Client generate
3. **interactive 확인**: prod가 source이면 'yes' 입력 요구 (`SKIP_INTERACTIVE=1`로 스킵 가능)
4. **Cloud SQL Auth Proxy spawn**: source/target 영역 양측 DB 영역 localhost:port 영역 binding (5432/5433)
5. **동기화 실행**: `npx tsx scripts/db-sync.ts SOURCE TARGET [--mask-pii]` (env 영역 주입 영역 host/port/password)
6. **Auth Proxy 정리**: `trap EXIT`으로 실패 시에도 자동 kill (PID 영역 박제)

#### 언제 수동 실행이 필요한가

- GitHub Actions 빌링 중단/다운
- 긴급 QA를 위한 즉시 동기화 (자정 자동 실행 기다릴 수 없음)
- 장애 대응 — prod 데이터로 dev 재구성

### 네트워크 접근 영역 (2026-05-27 GCP 영역 정합)

Azure 영역 방화벽 영역 임시 추가/제거 영역 폐기 — Cloud SQL Auth Proxy 영역 spawn/kill 영역 대체:

- Auth Proxy spawn 시 source/target 양측 DB 영역 → 127.0.0.1:port 영역 binding (IAM 인증 영역 자동)
- 동기화 완료 후 (실패 포함) 반드시 kill (`if: always()` / `trap EXIT` + PID 영역 박제)
- Auth Proxy binary: `/tmp/cloud-sql-proxy-v2.13.0` (캐시 영역 / 미존재 시 GCS 영역 자동 다운로드)
- Cloud SQL 인스턴스 영역 0.0.0.0/0 영역 allowlist 영역 폐기 영역 (Auth Proxy 영역 정합)

### 스크립트 (2026-05-27 GCP 영역 정합)

| 스크립트 | 용도 | 진입점 |
|---------|------|-------|
| `scripts/db-sync.ts` | 데이터 동기화 코어 (Prisma 기반, PII 마스킹 지원, 환경별 host/port/password 영역 주입) | 다른 스크립트가 호출 |
| `scripts/db-sync-remote.sh` | 원격 DB 간 동기화 래퍼 (Auth Proxy spawn + interactive 확인) | `make db-sync-*` |
| `scripts/db-sync-local.sh` | dev → localhost 동기화 (Auth Proxy spawn) | `make db-sync-dev-to-local` |

### 동기화 대상 테이블

Prisma 모델 24개 중 **17개** 복사. 나머지는 환경별 독립이 합리적이라 제외.

**포함 (17)**: Author, Theme, Work, Episode, SocialAccount, SignupHistory, CreditLog, Bookmark, ReadingProgress, Like, Subscription, Comment, Payment, DailyView, **Announcement, FeaturedWork, SystemSetting**

**제외 (7, 환경별 독립)**: AccessLog, AdminAuditLog, ChatSession, ChatMessage, RefreshToken, Report, UserSanction

---

## 11. Cloudflare DNS 설정 가이드

### CNAME 레코드 설정 (2026-04-19 기준)

| 레코드 | 이름 | 대상 |
|--------|------|------|
| CNAME | grimoire-book.com | grimoire-web-prod.{FQDN} |
| CNAME | dev.grimoire-book.com | grimoire-web-dev.{FQDN} |
| CNAME | api.grimoire-book.com | grimoire-server-prod.{FQDN} |
| CNAME | dev-api.grimoire-book.com | grimoire-server-dev.{FQDN} |

> 2026-04-19에 `inhouse.grimoire-book.com`, `inhouse-api.grimoire-book.com` 2개 레코드 삭제됨.
> FQDN은 Azure Container Apps 생성 후 확인 가능:
> ```bash
> az containerapp show --name grimoire-server-prod --resource-group zenith-rg --query "properties.configuration.ingress.fqdn" -o tsv
> ```

### SSL 설정

- Cloudflare SSL: Full (strict)
- Azure Container Apps: 자동 HTTPS 인증서

---

## 12. 초기 세팅

### 12.1 Azure 리소스 일괄 생성

```bash
chmod +x scripts/azure-setup.sh
./scripts/azure-setup.sh
```

상세: `scripts/azure-setup.sh` 참조.

### 12.2 로컬 배포 머신 사전 세팅 (최초 1회)

`make deploy-*` 실행 전 맥북 로컬에서 **필수 1회** 세팅해야 하는 항목들. 누락 시 `az acr login` 단계에서 macOS TCC가 `python3.13` 권한 다이얼로그를 매 실행마다 띄워 자동화가 중단된다.

- **Docker credential store**: `~/.docker/config.json`의 `credsStore`를 반드시 `"osxkeychain"`으로. Docker Desktop 기본값 `"desktop"`을 쓰면 TCC 다이얼로그 반복 발생.
- **az CLI 로그인**: `rainmaker8492@gmail.com` 계정.
- **Docker Desktop 기동**: `docker info` 통과 확인.

상세 절차 + 해결 근거: `docs/DEPLOY.md §3 로컬 배포 머신 사전 세팅` 참조.

---

## 13. 참조 문서

- `docs/environments.md` — 빌드 환경 + 배포 전략 (정본)
- `SECURITY.md` — 보안 정책 + 배포 전 체크리스트
- `TECH_STATUS.md` — 현재 구현 상태
