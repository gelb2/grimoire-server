# INFRASTRUCTURE.md — grimoire-server

> GCP 인프라 구성 + 운영 명령어 (Cloud Run + Cloud SQL + Artifact Registry + GCS).
> 참조: `docs/environments.md` (정본), `SECURITY.md`, `docs/DEPLOY.md` (수동 배포 정본)
>
> **2026-05-27: Azure → GCP 마이그레이션 완료** (Phase 0~6 + Auth Proxy + Secret Manager).
> 4 도메인 전부 GCP 운영 정합(200 OK).
> **2026-06-04: Azure decommission 완료** (Phase 7) — `zenith-rg` 18 리소스 전체 삭제(RG NotFound). 현역 인프라는 **GCP 단독**. 마이그레이션 이력은 §12 참조.
> **2026-04-19: `inhouse` 환경 제거 (3환경 → 2환경).** QA는 dev에서 develop 브랜치로 수행.

---

## 1. GCP 리소스 구성

| 리소스 | 서비스 | 용도 |
|--------|--------|------|
| grimoire-server-{dev,prod} | Cloud Run | API 서버 (4 서비스 중 2) |
| grimoire-web-{dev,prod} | Cloud Run | 웹 프론트엔드 (4 서비스 중 2) |
| grimoire-db-{dev,prod} | Cloud SQL for PostgreSQL 16 (db-f1-micro Enterprise) | 데이터베이스 |
| grimoire-docker | Artifact Registry (DOCKER format) | Docker 이미지 저장소 (수동 push) |
| cloud-run-source-deploy | Artifact Registry (자동 생성) | Cloud Build source deploy 시 자동 이미지 저장소 |
| grimoire-blob-{dev,prod} | Cloud Storage | 커버 이미지 + 테마 CSS CDN (public IAM) |
| Secret Manager (16건) | Secret Manager | 비밀값 보관 (DATABASE_URL, JWT, API keys 등) |
| Cloud Run Domain Mapping (4건) | Cloud Run | 커스텀 도메인 + Google managed cert |

> **프로젝트**: `grimoire-491708` (project number `23295981916`)
> **리전**: `asia-northeast1` (Tokyo, 모든 리소스 단일 리전 통일)
> 새 리전/프로젝트 생성 금지.

### 리소스 명명 패턴

- Cloud Run: `grimoire-{server,web}-{dev,prod}`
- Cloud SQL: `grimoire-db-{dev,prod}` (connection name `{project}:{region}:{instance}`)
- Cloud Storage bucket: `grimoire-blob-{dev,prod}`
- Secret Manager: `{name}-{dev,prod}-an1` (asia-northeast1 region 접미사)
- Artifact Registry repo: `grimoire-docker` (수동 푸시용 단일 repo) + `cloud-run-source-deploy` (자동)

---

## 2. 환경별 URL 매핑

| 환경 | Web URL | API URL | DB |
|------|---------|---------|-----|
| localhost | localhost:3001 | localhost:3000 | Docker 로컬 PostgreSQL (localhost:5432) |
| development | dev.grimoire-book.com | dev-api.grimoire-book.com | grimoire-db-dev (Auth Proxy) |
| production | grimoire-book.com | api.grimoire-book.com | grimoire-db-prod (Auth Proxy) |

### Cloud Run 공개 URL (도메인 매핑 외 직접 접근용)

| 서비스 | URL 패턴 |
|--------|---------|
| grimoire-server-dev | `https://grimoire-server-dev-tolwmynw6a-an.a.run.app` |
| grimoire-server-prod | `https://grimoire-server-prod-tolwmynw6a-an.a.run.app` |
| grimoire-web-dev | `https://grimoire-web-dev-tolwmynw6a-an.a.run.app` |
| grimoire-web-prod | `https://grimoire-web-prod-tolwmynw6a-an.a.run.app` |

> 또는 project number 형식: `https://grimoire-{server,web}-{env}-23295981916.asia-northeast1.run.app`
> 두 형식 모두 동일 서비스 가리킴 (Cloud Run 공식 dual hostname).
> localhost는 GCP 리소스를 사용하지 않는다. `docker-compose up db`로 로컬 DB를 띄운다.

### 환경별 설정

| 항목 | localhost | development | production |
|------|-----------|-------------|------------|
| Swagger | 활성화 | 활성화 | **비활성화** |
| CORS | localhost:3001 | dev.grimoire-book.com (+ `*` 허용) | grimoire-book.com |
| 로깅 | verbose | verbose | warn |
| 마이그레이션 | 자동 | 자동 | RUN_MIGRATION=true 필요 |
| 데이터 관리 | 시드 1회 + 마이그레이션/API | 마이그레이션/API만 | 마이그레이션/API만 |
| min instances | - | **0** | **0** |
| max instances | - | **1** | **1** |
| CPU / Memory | - | 1 vCPU / 512Mi | 1 vCPU / 512Mi |

상세 환경변수는 `docs/environments.md` 참조.

---

## 3. 환경변수 매핑 (Secret Manager + plain)

> 모든 비밀값은 Secret Manager 단일 진실. Cloud Run env로 `--set-secrets` 바인딩.
> 공개 안전 변수만 `--set-env-vars`로 평문 주입.

### 3.1 Secret Manager 16건 (asia-northeast1)

| Secret 이름 패턴 | 용도 | 양 환경 |
|---|---|---|
| database-url-authproxy-{dev,prod}-an1 | DATABASE_URL (Auth Proxy Unix socket 형식) | 필수 |
| jwt-secret-{dev,prod}-an1 | JWT 서명 키 | 필수 |
| recaptcha-secret-key-{dev,prod}-an1 | reCAPTCHA v3 서버 검증 키 | 필수 |
| anthropic-api-key-{dev,prod}-an1 | Claude API 키 (테마/AI 분석) | 필수 |
| openai-api-key-{dev,prod}-an1 | OpenAI API 키 (RAG 임베딩) | 선택 |
| polar-access-token-{dev,prod}-an1 | Polar 결제 OAT | 필수 |
| polar-webhook-secret-{dev,prod}-an1 | Polar Webhook 서명 검증 | 필수 |
| azure-storage-account-key-{dev,prod}-an1 | (구 Azure Blob Key) **dead** — Cloud Run 참조 0건 (2026-06-10 env 제거). Secret 삭제는 사용자 결정 영역. |

> **잔존 northeast3 region 시크릿 9건**: Phase 5 이전 시도 시 생성. 현재 미사용, 별도 정리 sprint에서 삭제 (ne3 GCP 영역 — 사용자 결정).

### 3.2 Cloud Run plain env (16건, 공개 안전)

| 변수 | 용도 | 양 환경 |
|---|---|---|
| `NODE_ENV` | Node/Express 표준값 (`production`/`development`) | 필수 |
| `APP_ENV` | 코드 내 환경 분기 (`production`/`development`) | 필수 |
| `PORT` | NestJS 리스닝 포트 (3000) | 필수 |
| `GCS_BUCKET` | `grimoire-blob-{dev,prod}` (Cloud Storage 버킷) | 필수 |
| `CORS_ORIGIN` | 환경별 Web URL | 필수 |
| `PUBLIC_API_BASE_URL` | 환경별 API URL + `/api` | 필수 |
| `GOOGLE_CLIENT_ID` | OAuth (Web도 동일 값) | 필수 |
| `POLAR_ORG_ID` | Polar organization ID (단일) | 필수 |
| `POLAR_SERVER` | `production` (양 환경 동일 — Polar org 단위 제약) | 필수 |
| `POLAR_PRODUCT_SUBSCRIPTION_{PRO,PREMIUM}` | CC-5 구독 정기결제 product UUID | 선택 |
| `POLAR_PRODUCT_CREDITS_{STARTER,BASIC,POPULAR,BEST}` | CC-2a 충전 4종 product UUID | 필수 |
| `RUN_MIGRATION` | prod에서 마이그레이션 실행 허용 (`true`) | 필수 (prod) |

### 3.3 DATABASE_URL 형식 (Auth Proxy)

Cloud Run에서 Cloud SQL 접근은 **Auth Proxy + Unix socket** 패턴:

```
postgresql://grimoireadmin:<MASKED>@/grimoire?host=/cloudsql/grimoire-491708:asia-northeast1:grimoire-db-{env}
```

> `host=/cloudsql/{connection_name}` — Cloud Run의 Cloud SQL connection이 자동 마운트하는 Unix socket.
> `sslmode=require` 불필요 (Unix socket 내부 통신).
> Cloud Run 서비스 deploy 시 `--add-cloudsql-instances` 플래그 필수.

---

## 4. Docker 이미지 (Artifact Registry)

### 이미지 태그 전략

```
asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-server:{env}-{SHA}
asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-server:{env}-latest
asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-web:{env}-{SHA}
asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-web:{env}-latest
```

- `{env}-{SHA}` 태그가 Cloud Run revision의 진실 (Container App 시절 규칙 동일 유지).
- `{env}-latest`는 편의 태그 — 배포 대상은 반드시 `{env}-{SHA}` 사용.
- Cloud Build source deploy 시 자동 repo `cloud-run-source-deploy`가 사용됨 (수동 push와 별개).

### gcloud 인증

```bash
gcloud auth login
gcloud config set project grimoire-491708
gcloud auth configure-docker asia-northeast1-docker.pkg.dev
```

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
docker build --platform linux/amd64 -t grimoire-server .
```

### 마이그레이션 제어

> 마이그레이션 규칙 상세: `MIGRATION.md` 참조

| 환경변수 | 값 | 동작 |
|---------|-----|------|
| SKIP_MIGRATION | true | 마이그레이션 완전 스킵 |
| RUN_MIGRATION | true | 프로덕션에서 마이그레이션 실행 허용 |
| (기본) | - | development: 자동 실행, production: 스킵 |

---

## 5. 운영 명령어

### 5.1 Cloud Run 운영

```bash
# 서비스 목록
gcloud run services list --region asia-northeast1

# 서비스 상세 (현 revision, traffic, env)
gcloud run services describe grimoire-server-dev --region asia-northeast1

# revision 목록 (최신 → 과거 순)
gcloud run revisions list --service grimoire-server-dev --region asia-northeast1

# revision 트래픽 분리 / 롤백
gcloud run services update-traffic grimoire-server-prod \
  --region asia-northeast1 \
  --to-revisions grimoire-server-prod-00003-5nl=100

# env 추가 / 갱신 (Secret 바인딩)
gcloud run services update grimoire-server-dev \
  --region asia-northeast1 \
  --update-secrets DATABASE_URL=database-url-authproxy-dev-an1:latest

# env 추가 / 갱신 (평문)
gcloud run services update grimoire-server-dev \
  --region asia-northeast1 \
  --update-env-vars POLAR_SERVER=production
```

### 5.2 Cloud SQL 운영

```bash
# 인스턴스 상태
gcloud sql instances list

# 인스턴스 상세 (tier, 백업, PITR)
gcloud sql instances describe grimoire-db-dev

# 사용자 / DB 목록
gcloud sql users list --instance grimoire-db-dev
gcloud sql databases list --instance grimoire-db-dev

# 마이그레이션 실행 (로컬에서 Cloud SQL Auth Proxy 통해)
./cloud-sql-proxy grimoire-491708:asia-northeast1:grimoire-db-dev --port 5432 &
DATABASE_URL="postgresql://grimoireadmin:<MASKED>@127.0.0.1:5432/grimoire" \
  npx prisma migrate deploy
```

### 5.3 Secret Manager 운영

```bash
# 시크릿 목록 (region 필터)
gcloud secrets list --filter="replication.userManaged.replicas.location=asia-northeast1"

# 시크릿 추가 (한번에 1 version)
echo -n "<MASKED>" | gcloud secrets create my-secret-dev-an1 \
  --replication-policy=user-managed --locations=asia-northeast1 --data-file=-

# 시크릿 갱신 (새 version 추가)
echo -n "<MASKED>" | gcloud secrets versions add my-secret-dev-an1 --data-file=-

# IAM 부여 (Cloud Run 서비스 계정)
gcloud secrets add-iam-policy-binding my-secret-dev-an1 \
  --member="serviceAccount:23295981916-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 5.4 Artifact Registry 운영

```bash
# repo 목록
gcloud artifacts repositories list --location asia-northeast1

# 이미지 태그 조회 (최신 5개)
gcloud artifacts docker tags list \
  asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-server \
  --limit=5 --sort-by=~CREATE_TIME

# 이미지 정리 (특정 SHA digest 삭제)
gcloud artifacts docker images delete \
  asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-server@sha256:<digest>
```

### 5.5 로깅 (실시간 + 검색)

```bash
# 실시간 로그 tail
gcloud run services logs tail grimoire-server-dev --region asia-northeast1

# 최근 N건 조회
gcloud run services logs read grimoire-server-dev --region asia-northeast1 --limit=200

# Cloud Logging 검색 (Console로도 가능)
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="grimoire-server-dev" AND severity>=ERROR' \
  --limit=50 --format=json
```

#### 5.5.1 Cron 모니터링 — PaymentReconciliationJob (PAY-P0-2, 2026-05-03)

10분 주기 cron이 정상 동작 중인지 Cloud Run 로그에서 확인:

```bash
# PaymentReconciliationJob 로그 필터 (10분 주기 PG↔DB 정합성 검증)
gcloud run services logs read grimoire-server-dev \
  --region asia-northeast1 --limit=500 \
  | grep "PaymentReconciliationJob"

# 기대 로그 패턴 (정상 동작):
# [PaymentReconciliationJob] PaymentReconciliationJob 시작 — since=...
# [PaymentReconciliationJob] PaymentReconciliationJob 완료 — processed=N boost=N mismatch=N expire=N
#
# 보정 발생 로그:
# [PaymentReconciliationJob] [boost] paymentId=... credits=N authorId=...
# [PaymentReconciliationJob] [refund_mismatch] paymentId=... PG=refunded DB=completed
# [PaymentReconciliationJob] [expire] paymentId=... pending 24h 경과 만료
#
# 예외 발생 로그 (운영자 즉시 점검):
# [PaymentReconciliationJob] PaymentReconciliationJob 예외 — ...
# [PaymentReconciliationJob] Polar list API 호출 실패 — ...
```

**cron 비활성화 (긴급 핫픽스)**:

```bash
gcloud run services update grimoire-server-dev \
  --region asia-northeast1 \
  --update-env-vars RECONCILIATION_DISABLED=1
```

**replicas 정책**:
- Cloud Run min=0/max=1 가정 (현 정합). 같은 process 내 in-memory `isRunning` lock으로 동시 실행 차단.
- max ≥2 시점에는 `pg_try_advisory_lock` 보강 필요 (PAY-P1).

#### 5.5.2 Cron 모니터링 — PaymentCleanupJob (PAY-P1-3, 2026-05-04)

매일 새벽 4시 cron으로 24h 초과 pending Payment 'expired' 마킹.

```bash
gcloud run services logs read grimoire-server-dev \
  --region asia-northeast1 --limit=500 \
  | grep "PaymentCleanupJob"

# 기대 로그 패턴 (정상 동작):
# [PaymentCleanupJob] PaymentCleanupJob 시작 — startedAt=... expireHours=24
# [PaymentCleanupJob] PaymentCleanupJob 완료 — expireCount=N stalePendingCount=N
# [PaymentCleanupJob] [cleanup] paymentId=... authorId=... elapsed=Nh → expired
#
# 비활성화 / 동시 실행 차단 로그:
# [PaymentCleanupJob] PAYMENT_CLEANUP_DISABLED=1 — cleanup cron 비활성화 (skip)
# [PaymentCleanupJob] PaymentCleanupJob 이미 실행 중 — 동시 실행 차단 (skip)
```

**cron 비활성화 (긴급 핫픽스)**:

```bash
gcloud run services update grimoire-server-dev \
  --region asia-northeast1 \
  --update-env-vars PAYMENT_CLEANUP_DISABLED=1
```

**시간대 정합**:
- PAY-P0-2 reconciliation: 새벽 3시 + 10분 주기
- PAY-P1-3 cleanup: 새벽 4시 1회만 (시간대/주기 분리, 동시 발동 방지)

### 5.6 Cloud Storage 운영

```bash
# bucket 목록
gcloud storage buckets list --filter="name:grimoire-blob"

# 파일 업로드
gcloud storage cp ./local-file.png gs://grimoire-blob-dev/themes/test.png

# bucket public IAM 확인 (allUsers:objectViewer 부여됨)
gcloud storage buckets get-iam-policy gs://grimoire-blob-dev

# 공개 URL: https://storage.googleapis.com/grimoire-blob-{env}/<path>
```

---

## 6. 트러블슈팅

### 6.1 Cloud SQL 연결 실패

증상: Cloud Run에서 `ECONNREFUSED /cloudsql/...` 또는 `password authentication failed`

원인 후보:
1. Cloud Run 서비스에 `--add-cloudsql-instances` 누락
2. Cloud SQL Auth Proxy IAM 누락 — Compute SA에 `roles/cloudsql.client` 필요
3. DATABASE_URL의 `host=/cloudsql/...` 경로 오타
4. Cloud SQL 인스턴스 STOPPED 상태

진단:
```bash
# 1) Cloud Run 서비스의 cloudsql annotation 확인
gcloud run services describe grimoire-server-dev --region asia-northeast1 \
  --format="value(spec.template.metadata.annotations['run.googleapis.com/cloudsql-instances'])"

# 2) IAM 확인
gcloud projects get-iam-policy grimoire-491708 \
  --flatten=bindings --format="value(bindings.role,bindings.members)" \
  | grep "23295981916-compute"

# 3) Cloud SQL 상태
gcloud sql instances describe grimoire-db-dev --format="value(state)"
```

### 6.2 Cert provisioning 지연

증상: 도메인 매핑 후 SSL `HTTP_INVALID_CERTIFICATE` / curl `SSL routines:tls_post_process_server_certificate`

원인: Google managed cert 발급 진행 중 (실측 평균 5~15분, 최대 1시간).

진단:
```bash
gcloud beta run domain-mappings describe \
  --domain api.grimoire-book.com --region asia-northeast1 \
  --format="value(status.conditions[].message)"
```

해결:
- DNS CNAME이 `ghs.googlehosted.com` (또는 apex의 A 4개 + AAAA 4개)으로 정확히 가리키는지 확인.
- Cloudflare proxied=**false** (orange-cloud OFF) 필수. orange-cloud ON이면 Google이 SSL 검증 못 함.
- 30분 후에도 안 되면 도메인 매핑 삭제 후 재생성.

### 6.3 IAM 권한 누락 (Secret/Storage/Run)

증상: `PERMISSION_DENIED: Permission '...' denied on resource ...`

기본 부여된 IAM (Compute SA `23295981916-compute@developer.gserviceaccount.com`):
- `roles/cloudsql.client`
- `roles/secretmanager.secretAccessor`
- `roles/editor` (기본 Compute SA 자동 부여, 광범위)

추가 필요 시:
```bash
gcloud projects add-iam-policy-binding grimoire-491708 \
  --member="serviceAccount:23295981916-compute@developer.gserviceaccount.com" \
  --role="roles/<필요 권한>"
```

---

## 7. 비용 모니터링

### 7.1 GCP 월 비용 추정 (cost-accountant 2026-05-27 PASS)

| 리소스 | 수량 | 월 비용 추정 |
|--------|------|---------|
| Cloud SQL db-f1-micro Enterprise + 10GB HDD | 2 | ~₩18,000 |
| Cloud Run (cpu=1, mem=512Mi, min=0/max=1) | 4 | ~₩6,000 (idle 비용 거의 0) |
| Artifact Registry | 1 | ~₩2,000 (10GB 이내) |
| Cloud Storage (Standard) | 2 | ~₩2,000 |
| Cloud Logging | - | ~₩3,000 |
| Egress (Cloud Run → 외부) | - | ~₩3,000 |
| **합계** | | **~₩34,000/월** |

### 7.2 Azure 대비 절감

| 항목 | Azure (기존) | GCP (신) | 절감 |
|---|---|---|---|
| 월 비용 | ~₩73,000 | ~₩34,000 | **-53%** |
| 연 비용 | ~₩876,000 | ~₩408,000 | **-₩468,000** |

> 절감 근거: db-f1-micro (₩9k/월) vs Azure B1ms (₩23.5k/월), Cloud Run pay-per-use (idle 0) vs Container Apps (min=0이지만 환경 비용 잔존).

### 7.3 예산 알림

```bash
# GCP Console → Billing → Budgets & alerts
# 또는 CLI
gcloud billing budgets list --billing-account=<billing-id>
```

---

## 8. 보안 체크리스트

- ✅ **Secret Manager 단일 진실**: 모든 비밀값(DATABASE_URL, JWT, API keys, Polar tokens)이 Secret Manager에 보관. Cloud Run env로 `--set-secrets` 바인딩.
- ✅ **Cloud SQL Auth Proxy 강제**: Public IP allowlist 제거 (`0.0.0.0/0` 폐기). 메인 IP `221.150.30.109/32`만 잔존 (수동 운영용, 비밀번호 + IAM 이중 보호).
- ✅ **IAM 최소 권한**: Compute SA에 `cloudsql.client` + `secretmanager.secretAccessor`만 명시 부여 (`editor`는 기본 부여, 추후 재검토).
- ✅ **Cloud Storage 공개**: `allUsers:objectViewer`만 부여 (object read-only, write/list 차단). 업로드는 SA 인증 후 server-side만.
- ✅ **Cloud Run 인증**: 공개 endpoint (`/api/*`)는 unauthenticated allow + 코드 레벨 `JwtAuthGuard` 강제. 관리자 endpoint는 `AdminGuard` 추가 (PAY-S3 Circuit Breaker 관리자 UI 정합).
- ✅ **Cloudflare SSL = Google managed cert**: proxied=false로 Google이 SSL 종단. cert 자동 갱신.

상세 보안 정책: `SECURITY.md` 참조.

---

## 9. 인프라 설정값 현황 (2026-05-27 GCP 정합)

> 인프라 설정 변경 시 이 표를 반드시 업데이트한다 (같은 커밋).
> 검증: `gcloud run services describe`, `gcloud sql instances describe`

### Cloud Run (4 서비스)

| 서비스 | CPU | 메모리 | min | max | concurrency | timeout | 포트 | 도메인 | SSL |
|----|-----|--------|----|----|----|----|------|---------|-----|
| grimoire-web-dev | 1 | 512Mi | 0 | 1 | 80 | 240s | 3001 | dev.grimoire-book.com | ✅ Google managed |
| grimoire-server-dev | 1 | 512Mi | 0 | 1 | 80 | 240s | 3000 | dev-api.grimoire-book.com | ✅ Google managed |
| grimoire-web-prod | 1 | 512Mi | 0 | 1 | 80 | 240s | 3001 | grimoire-book.com (apex) | ✅ Google managed |
| grimoire-server-prod | 1 | 512Mi | 0 | 1 | 80 | 240s | 3000 | api.grimoire-book.com | ✅ Google managed |

> `min=0` 정책: idle 시 instance 0개. cold start 5~15초 (Cloud Run pay-per-use 절감 정책).
> max=1 이유: 비용 폭탄 방지 + 단일 instance 진실 (PaymentReconciliationJob 등 cron lock 정합).

### Cloud SQL (2 인스턴스)

| 인스턴스 | tier | 스토리지 | autoGrow | 백업 | PITR | HA |
|----|-----|---------|----------|------|------|-----|
| grimoire-db-dev | db-f1-micro (Enterprise) | 10GB HDD | 꺼짐 | 매일 18:00 KST | 7일 | 꺼짐 |
| grimoire-db-prod | db-f1-micro (Enterprise) | 10GB HDD | 꺼짐 | 매일 18:00 KST | 7일 | 꺼짐 |

> PG 16, Enterprise edition (Enterprise Plus 아님 — 비용 절감).
> connection name: `grimoire-491708:asia-northeast1:grimoire-db-{env}`
> Public IP 활성화 (Auth Proxy 통신용) — 메인 IP `221.150.30.109/32` allowlist만 잔존.

### Artifact Registry

| repo | format | region | 이미지 정리 |
|------|--------|--------|----------|
| grimoire-docker | DOCKER | asia-northeast1 | 수동 (배포 스크립트가 `{env}-` prefix별 최근 5개만 유지) |
| cloud-run-source-deploy | DOCKER | asia-northeast1 | 자동 생성 (Cloud Build source deploy 시) |

### Cloud Storage

| bucket | location | storage class | public IAM |
|--------|----------|--------------|-----------|
| grimoire-blob-dev | asia-northeast1 | Standard | `allUsers:objectViewer` |
| grimoire-blob-prod | asia-northeast1 | Standard | `allUsers:objectViewer` |

---

## 10. DB 동기화 정책

> 운영 데이터를 하위 환경으로 동기화하여 테스트 데이터 정합성을 확보한다.

### 동기화 흐름 (2026-04-19 inhouse 제거 후)

```
prod ──→ dev     (PII 마스킹)
dev  ──→ local   (수동, 이미 마스킹된 데이터)
```

### 자동 동기화 (GitHub Actions) — 2026-05-27 GCP 정합

| 항목 | 값 |
|------|-----|
| 워크플로우 | `.github/workflows/db-sync-nightly.yml` |
| 스케줄 | 매일 자정 KST (UTC 15:00) |
| 수동 트리거 | `workflow_dispatch` (source/target/mask 선택) |
| 필요 시크릿 | `GCP_SA_KEY` (Service Account JSON), `DB_PASSWORD_PROD`, `DB_PASSWORD_DEV` |
| 인증 방식 | `google-github-actions/auth@v2` (SA Key JSON) |
| DB 연결 | Cloud SQL Auth Proxy v2.13.0 (source=127.0.0.1:5432, target=127.0.0.1:5433) |
| Cloud SQL 인스턴스 | `grimoire-491708:asia-northeast1:grimoire-db-{prod\|dev}` |
| db-sync SA | `github-actions-db-sync@grimoire-491708.iam.gserviceaccount.com` (roles/cloudsql.client + admin + storage.objectAdmin) |

### PII 마스킹 정책

| 대상 → | dev | local |
|--------|:---:|:-----:|
| email | 마스킹 | 마스킹 |
| passwordHash | 마스킹 | 마스킹 |
| providerEmail | 마스킹 | 마스킹 |

마스킹 형식: `author-{n}@masked.local`, 고정 bcrypt 해시

### 수동 동기화 (비상용 + 즉시 실행 필요 시)

`docs/DEPLOY.md §9` 원칙 "수동 실행은 긴급 수단으로 계속 유지. 스크립트가 정본, CI는 래퍼"를 DB 동기화에도 동일 적용.

#### Makefile 진입점

```bash
# prod 관련은 interactive 'yes' 확인 프롬프트 있음 (CI에선 SKIP_INTERACTIVE=1)
export DB_PASSWORD_PROD='<MASKED>'   # prod Cloud SQL 비밀번호
export DB_PASSWORD_DEV='<MASKED>'    # dev Cloud SQL 비밀번호
gcloud auth login                    # 선행 (project=grimoire-491708 정합)
gcloud config set project grimoire-491708

make db-sync-prod-to-dev             # prod → dev (PII 마스킹)
make db-sync-dev-to-local            # dev → localhost (Docker DB 필요)
```

#### 동작 순서 (scripts/db-sync-remote.sh)

1. **입력 검증**: SOURCE/TARGET 유효성 + 방향 검증 (하위→상위 금지)
2. **preflight**: `DB_PASSWORD_{ENV}` 환경변수 + `gcloud auth` + project 정합 + Prisma Client generate
3. **interactive 확인**: prod가 source이면 'yes' 입력 요구 (`SKIP_INTERACTIVE=1`로 스킵 가능)
4. **Cloud SQL Auth Proxy spawn**: source/target 양측 DB를 localhost:port에 binding (5432/5433)
5. **동기화 실행**: `npx tsx scripts/db-sync.ts SOURCE TARGET [--mask-pii]` (env 주입: host/port/password)
6. **Auth Proxy 정리**: `trap EXIT`으로 실패 시에도 자동 kill (PID 박제)

#### 언제 수동 실행이 필요한가

- GitHub Actions 빌링 중단/다운
- 긴급 QA를 위한 즉시 동기화 (자정 자동 실행 기다릴 수 없음)
- 장애 대응 — prod 데이터로 dev 재구성

### 네트워크 접근 (2026-05-27 GCP 정합)

Azure 방화벽 임시 추가/제거 폐기 — Cloud SQL Auth Proxy spawn/kill로 대체:

- Auth Proxy spawn 시 source/target 양측 DB → 127.0.0.1:port binding (IAM 인증 자동)
- 동기화 완료 후 (실패 포함) 반드시 kill (`if: always()` / `trap EXIT` + PID 박제)
- Auth Proxy binary: `/tmp/cloud-sql-proxy-v2.13.0` (캐시 / 미존재 시 GCS에서 자동 다운로드)
- Cloud SQL 인스턴스 `0.0.0.0/0` allowlist 폐기 (Auth Proxy 정합)

### 스크립트

| 스크립트 | 용도 | 진입점 |
|---------|------|-------|
| `scripts/db-sync.ts` | 데이터 동기화 코어 (Prisma 기반, PII 마스킹 지원, 환경별 host/port/password 주입) | 다른 스크립트가 호출 |
| `scripts/db-sync-remote.sh` | 원격 DB 간 동기화 래퍼 (Auth Proxy spawn + interactive 확인) | `make db-sync-*` |
| `scripts/db-sync-local.sh` | dev → localhost 동기화 (Auth Proxy spawn) | `make db-sync-dev-to-local` |

### 동기화 대상 테이블

Prisma 모델 24개 중 **17개** 복사. 나머지는 환경별 독립이 합리적이라 제외.

**포함 (17)**: Author, Theme, Work, Episode, SocialAccount, SignupHistory, CreditLog, Bookmark, ReadingProgress, Like, Subscription, Comment, Payment, DailyView, **Announcement, FeaturedWork, SystemSetting**

**제외 (7, 환경별 독립)**: AccessLog, AdminAuditLog, ChatSession, ChatMessage, RefreshToken, Report, UserSanction

---

## 11. Cloudflare DNS 설정 가이드

> 2026-05-27 GCP 정합: Azure Container Apps FQDN 폐기 → Google Cloud Run Domain Mapping target.
> Cloudflare proxied = **false** 강제 (Google이 SSL 종단).

### DNS 레코드 (실측)

| 도메인 | Type | 대상 | proxied |
|--------|------|------|---------|
| grimoire-book.com (apex) | A x4 | 216.239.32.21 / 216.239.34.21 / 216.239.36.21 / 216.239.38.21 | false |
| grimoire-book.com (apex) | AAAA x4 | 2001:4860:4802:32::15 / :34::15 / :36::15 / :38::15 | false |
| dev.grimoire-book.com | CNAME | ghs.googlehosted.com | false |
| api.grimoire-book.com | CNAME | ghs.googlehosted.com | false |
| dev-api.grimoire-book.com | CNAME | ghs.googlehosted.com | false |

> Polar webhook URL: `api.grimoire-book.com` 보존 (Azure→GCP 이전 시 변경 0건).
> apex 도메인은 Google이 제공하는 4 IP (A/AAAA 각 4개) 사용 — Cloud Run Domain Mapping 표준.

### SSL 설정

- Cloud Run Domain Mapping: Google managed cert (auto-renewal, strict, ACME)
- Cloudflare SSL mode: Full (strict) — Google cert를 그대로 종단

### Domain Mapping 생성/삭제

```bash
# 생성
gcloud beta run domain-mappings create \
  --service grimoire-server-prod \
  --domain api.grimoire-book.com \
  --region asia-northeast1

# 상태 확인 (cert provisioning 진행 추적)
gcloud beta run domain-mappings describe \
  --domain api.grimoire-book.com --region asia-northeast1

# 삭제
gcloud beta run domain-mappings delete \
  --domain api.grimoire-book.com --region asia-northeast1
```

---

## 12. Azure decommission 이력 (2026-06-04 완료)

> **현재 인프라는 GCP 단독.** Azure는 2026-06-04 `zenith-rg` 전체 삭제로 완전 decommission 완료(RG NotFound 확정). 본 절은 마이그레이션·삭제 이력 보존용이며, 현역 자원이 아니다.

### 삭제된 Azure 리소스 (구 `zenith-rg`, Korea Central — 2026-06-04 전체 삭제)

2026-05-27 GCP 마이그레이션(Phase 0~6 + Auth Proxy + Secret Manager) 완료 후, ≥1주 안정성 모니터링을 거쳐 2026-06-04 아래 18 리소스를 의존 역순으로 staged 삭제 → RG 일괄 삭제했다. 최종 dump 2건(`gs://grimoire-491708-db-migration/azure-final/`)을 영속 보관(≥30일).

| 구 리소스 | GCP 대체 | 삭제 |
|---|---|---|
| Container Apps × 4 (grimoire-server-{dev,prod}, grimoire-web-{dev,prod}) | Cloud Run × 4 (asia-northeast1) | ✅ 삭제 완료 |
| Postgres Flexible × 2 (grimoire-db-{dev,prod}) | Cloud SQL × 2 (asia-northeast1) | ✅ 삭제 완료 (최종 dump 보관) |
| ACR `grimoireacr` | Artifact Registry `cloud-run-source-deploy` | ✅ 삭제 완료 |
| Blob Storage `grimoire0storage` | GCS `grimoire-blob-{prod,dev}` (`GcsStorageService`) | ✅ 삭제 완료 |
| Log Analytics × 3 | Cloud Logging | ✅ 삭제 완료 |
| Managed Environment + Managed Certificate × 6 | Cloud Run Domain Mapping × 4 (Google managed cert) | ✅ 삭제 완료 |

### Azure 흔적 정리 후속 (2026-06-10)

- **`AZURE_STORAGE_*` dead env 제거**: Cloud Run `grimoire-server-{prod,dev}`에서 `AZURE_STORAGE_ACCOUNT_NAME`(plain) + `AZURE_STORAGE_ACCOUNT_KEY`(secretRef) 제거 — DI가 `BlobStoragePort → GcsStorageService`로 대체된 dead env(런타임 read 없음). prod rev `00006-rd9` / dev rev `00006-m9d` Healthy, 4 도메인 health 무영향.
- **Secret Manager `azure-storage-account-key-{dev,prod}-an1`**: Cloud Run 참조 0건 (dead). Secret 삭제는 사용자 결정 영역으로 보류.

### 모든 Azure 트래픽이 GCP로 전환된 시점

- 2026-05-27: 4 도메인 (api / dev-api / dev / apex) 200 OK 정합 + Polar webhook 정합 + Cron 정합
- 2026-06-04: Azure `zenith-rg` 완전 삭제 후에도 4 도메인 307/200/307/200 동일 = Azure↔GCP 독립 입증

---

## 13. 초기 세팅

### 13.1 GCP 리소스 생성 (Phase 0~6 완료, 재현용 참조)

- Cloud SQL × 2: `gcloud sql instances create` + Auth Proxy 설정
- Cloud Run × 4: 이미지 푸시 후 `gcloud run deploy`
- Domain Mapping × 4: `gcloud beta run domain-mappings create` + Cloudflare DNS 변경
- Secret Manager 16건: `gcloud secrets create` + IAM `secretmanager.secretAccessor`
- GCS bucket × 2: `gcloud storage buckets create` + public IAM `allUsers:objectViewer`

> 재현 절차 상세는 `.claude/state/sprint-gcp-migration-plan-draft.md` 참조 (Phase 0~6 단계별 명령).

### 13.2 로컬 배포 머신 사전 세팅 (최초 1회)

`make deploy-*` 실행 전 맥북 로컬에서 **필수 1회** 세팅. 누락 시 `gcloud auth configure-docker` 단계에서 macOS TCC가 다이얼로그를 반복할 수 있음.

- **Docker credential store**: `~/.docker/config.json`의 `credsStore`를 반드시 `"osxkeychain"`으로. Docker Desktop 기본값 `"desktop"`을 쓰면 TCC 다이얼로그 반복 발생 (Azure 시절 정합 동일).
- **gcloud auth**: `gcloud auth login` + `gcloud config set project grimoire-491708`
- **Artifact Registry Docker 인증**: `gcloud auth configure-docker asia-northeast1-docker.pkg.dev`
- **Docker Desktop 기동**: `docker info` 통과 확인.

상세 절차 + 해결 근거: `docs/DEPLOY.md §3 로컬 배포 머신 사전 세팅` 참조.

---

## 14. 참조 문서

- `docs/environments.md` — 빌드 환경 + 배포 전략 (정본)
- `docs/DEPLOY.md` — 수동 배포 절차 (정본)
- `SECURITY.md` — 보안 정책 + 배포 전 체크리스트
- `TECH_STATUS.md` — 현재 구현 상태
- `MIGRATION.md` — DB 마이그레이션 규칙 + 롤백 가이드
