# DEPLOY.md — 수동 배포 절차 (server + web)

> GitHub Actions가 빌링 이슈 등으로 차단된 경우의 **1차 배포 수단**.
> 평시에도 긴급 패치/롤백에 사용.
> 정본: 이 문서. INFRASTRUCTURE.md §5/§9가 참조한다.
>
> **2026-05-27: Azure → GCP 마이그레이션 완료.** Cloud Run + Artifact Registry + Cloud SQL Auth Proxy + Secret Manager 정합.
> **2026-06-04: Azure decommission 완료** (`zenith-rg` 삭제). 현역 인프라 = GCP 단독.
> **2026-04-19: `inhouse` 환경 제거 (3환경 → 2환경).** QA는 dev에서 develop 브랜치로 수행.

> ✅ **배포 스크립트 GCP 전환 완료 (2026-06-10)**: `scripts/deploy-common.sh`(+`deploy-{dev,prod}.sh`/`preflight.sh`)를 `az containerapp`/ACR/zenith-rg → **gcloud(Cloud Run + Artifact Registry + Cloud SQL)** 기반으로 전환했다(2026-06-04 Azure decommission으로 무력화돼 있던 것을 복구). `make deploy-dev`/`make deploy-prod`가 다시 동작한다.
>
> 잔여 정직 박제:
> - **배포 방식** = `docker build` + `docker push` → Artifact Registry `grimoire-docker` repo + `gcloud run deploy --image {prefix}-{SHA}` (명시 태그 컨벤션 — 구 ACR `az containerapp update --image` 방식 이식).
> - **Docker daemon 필요** — `preflight.sh` 6/8 단계가 `docker info`로 검사한다(미실행 시 배포 중단).
> - **첫 `make deploy-{env}`가 비어 있는 `grimoire-docker` AR repo를 채운다** — 5/27~현재 실제 배포는 모두 `cloud-run-source-deploy` repo(Cloud Build source deploy)를 사용했으므로 `grimoire-docker`에는 수동 푸시 이미지가 아직 없을 수 있다.
> - **두 배포 방식 공존 가능**: 5/27~현재 실배포는 `gcloud run deploy --source`(Cloud Build 자동 빌드, `cloud-run-source-deploy` repo)였고, 본 전환은 명시-태그(`--image {prefix}-{SHA}`) 방식으로 복원한 것이다. 같은 `Dockerfile`을 쓰므로 두 방식이 공존한다.
> - **end-to-end 검증은 실 배포로 확정 필요** — 본 전환은 **정적 안전성 검증**(db-sync 유틸 보존 / preflight·매트릭스 재현 / live az 호출 0 / 라이브 배포 0)까지다. `make deploy-dev` 실 1회로 빌드→푸시→revision Ready→endpoint 200 흐름이 최종 확정된다.

---

## 1. 환경 매트릭스 (2026-05-27 GCP 실측 기준)

> **이 표의 값은 절대 변경 금지**. 변경이 필요하면 이 문서를 먼저 수정하고 스크립트를 수정한다.

### 공통 상수

| 항목 | 값 |
|------|-----|
| GCP 프로젝트 | `grimoire-491708` (project number `23295981916`) |
| GCP 리전 | `asia-northeast1` (Tokyo, 단일 리전) |
| Artifact Registry repo (수동) | `asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker` |
| Artifact Registry repo (자동, Cloud Build) | `asia-northeast1-docker.pkg.dev/grimoire-491708/cloud-run-source-deploy` |
| Cloud Run 서비스 계정 | `23295981916-compute@developer.gserviceaccount.com` |
| Cloud Run 공개 URL pattern | `https://grimoire-{server,web}-{env}-tolwmynw6a-an.a.run.app` |
| 빌드 플랫폼 | `linux/amd64` |
| 이미지 유지 개수 | 환경별 prefix당 최근 5개 (스크립트 자동 정리) |
| Cloud Run 스케일 | `min=0, max=1, cpu=1, memory=512Mi, concurrency=80, timeout=240s` |

### 환경별 매트릭스

| 항목 | dev | prod |
|------|-----|------|
| **브랜치** | `develop` | `main` |
| **이미지 태그** | `dev-{SHA}` + `dev-latest` | `prod-{SHA}` + `prod-latest` |
| **Server Cloud Run** | `grimoire-server-dev` | `grimoire-server-prod` |
| **Web Cloud Run** | `grimoire-web-dev` | `grimoire-web-prod` |
| **Cloud SQL connection** | `grimoire-491708:asia-northeast1:grimoire-db-dev` | `grimoire-491708:asia-northeast1:grimoire-db-prod` |
| **DB 접속 방식** | Cloud SQL Auth Proxy (Unix socket) | Cloud SQL Auth Proxy (Unix socket) |
| **GCS bucket** | `grimoire-blob-dev` | `grimoire-blob-prod` |
| **Web → Server API_URL** | `https://grimoire-server-dev-tolwmynw6a-an.a.run.app/api` | `https://grimoire-server-prod-tolwmynw6a-an.a.run.app/api` |
| **CORS_ORIGIN** | `*` ⚠️ | `https://grimoire-book.com` |
| **APP_ENV (server)** | `development` | `production` |
| **NODE_ENV (server)** | `development` | `production` |
| **Web `NEXT_PUBLIC_APP_ENV` 빌드 인자** | `development` | `production` |
| **공개 웹 URL** | `https://dev.grimoire-book.com` | `https://grimoire-book.com` |
| **공개 API URL** | `https://dev-api.grimoire-book.com` | `https://api.grimoire-book.com` |

> ⚠️ **dev CORS `*`**: 의도된 느슨한 설정이지만 CLAUDE.md §11 전수검사 기준으론 경고. 별도 이슈 참조.

### Polar 주의사항

- `POLAR_SERVER=production`은 **2환경 모두 동일**. Polar는 organization 단위로 토큰이 발급되어 환경별 분리 불가. `memory/feedback_polar_coupon_ops.md` 참조.
- Polar 관련 환경변수 (Secret Manager + plain 혼용):
  - **Secret Manager**: `polar-access-token-{env}-an1`, `polar-webhook-secret-{env}-an1`
  - **plain env**: `POLAR_ORG_ID`, `POLAR_SERVER=production`, `POLAR_PRODUCT_CREDITS_{STARTER,BASIC,POPULAR,BEST}`, `POLAR_PRODUCT_SUBSCRIPTION_{PRO,PREMIUM}` (CC-5)
- Polar Webhook URL: `https://api.grimoire-book.com/api/webhooks/polar` (Azure→GCP 이전 시 변경 0건).

---

## 2. 이미지 태그 전략 (Artifact Registry)

```
asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-server:{env}-{SHA}    ← Cloud Run이 가리키는 태그
asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-server:{env}-latest   ← 편의 태그 (참조용)
asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-web:{env}-{SHA}
asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-web:{env}-latest
```

- **SHA**는 `git rev-parse HEAD` 값(배포하려는 커밋).
- `{env}-latest`는 편의 태그 — 배포 대상은 **반드시 `{env}-{SHA}` 태그**를 사용해야 Cloud Run revision이 내용 기반으로 생성된다.
- 롤백: 과거 `{env}-{SHA}` 태그로 Cloud Run `--image`를 되돌린다.

### ⚠️ `:latest` 태그 금지

Cloud Run이 `:latest` 태그로 배포되어 있으면 revision이 내용 기반으로 생성되지 않아 사실상 업데이트가 안 될 수 있다. 새 스크립트로 배포 시 자동으로 `{env}-{SHA}` 태그가 설정된다.

---

## 3. 로컬 배포 머신 사전 세팅 (최초 1회)

`make deploy-*` 실행 전 로컬 머신에서 **반드시 1회** 수행해야 하는 준비 작업. 누락 시 배포 중 사용자 상호작용이 필요해지므로 자동화가 깨진다.

### 3.1 Docker credential store — `osxkeychain` 강제

**증상**: `docker login` / `gcloud auth configure-docker` 단계에서 다음 macOS 시스템 다이얼로그가 매 실행마다 뜸.

> `python3.13`이(가) 다른 앱의 데이터에 접근하려고 합니다. [허용 안 함] [허용]

**원인**:
- Docker Desktop 4.x 설치 시 `~/.docker/config.json`의 `credsStore` 기본값이 `"desktop"`으로 설정됨.
- 이 값이면 `docker login` / `gcloud auth configure-docker` 가 자격증명을 Docker Desktop 샌드박스 영역(`~/Library/Containers/com.docker.docker/`)에 저장.
- macOS Sequoia+ TCC가 CLI(`gcloud`/Azure CLI python3.13)이 **다른 앱(Docker Desktop)의 데이터에 접근**하는 것으로 감지 → 매번 권한 다이얼로그.

**해결 (최초 1회)**:

```bash
# 1) ~/.docker/config.json 의 credsStore 값 변경
#    "credsStore": "desktop"      ← 변경 전
#    "credsStore": "osxkeychain"  ← 변경 후

# 2) Artifact Registry 자격증명을 macOS Keychain에 재저장
gcloud auth configure-docker asia-northeast1-docker.pkg.dev
# → "Adding credentials for: asia-northeast1-docker.pkg.dev" + "credential helpers were configured" 확인

# 3) Keychain 저장 확인
echo "asia-northeast1-docker.pkg.dev" | docker-credential-osxkeychain get
# → JWT 토큰 JSON이 출력되면 정상
```

이후 `make deploy-*` 실행 시 TCC 다이얼로그 뜨지 않는다. Keychain 접근은 macOS 표준 자격증명 저장소라 gcloud python이 접근해도 "다른 앱" 판정이 뜨지 않는다.

> **Azure ACR 로컬 흔적**: Azure는 2026-06-04 decommission 완료(`INFRASTRUCTURE.md §12`). 단 `grimoireacr.azurecr.io` Keychain 항목은 로컬 머신에 잔존할 수 있음(Azure 삭제와 무관한 로컬 자격증명) → `security delete-internet-password -s grimoireacr.azurecr.io`로 제거 가능(선택).

**금지**: `credsStore` 항목을 삭제하지 말 것. 삭제 시 `auths`에 base64 평문 자격증명이 저장되어 보안 사고 위험.

### 3.2 gcloud CLI 로그인 유지

```bash
gcloud auth login                          # 계정 선택 브라우저 창
gcloud config set project grimoire-491708  # 프로젝트 고정
gcloud config list                         # account / project 정합 확인
```

`preflight.sh`가 project=`grimoire-491708` 정합을 검증한다.

### 3.3 Docker Desktop 기동

`make deploy-*` 시 `docker info`가 실패하면 배포 중단된다. Docker Desktop 앱이 실행 상태여야 함.

```bash
open -a Docker   # 기동 후 약 10~30초 대기
docker info      # 정상이면 ServerVersion 출력
```

---

## 4. 배포 스크립트 구조

```
grimoire-server/
├── Makefile                        # 진입점
└── scripts/
    ├── deploy-common.sh            # 공통 상수/함수 (source로 로드)
    ├── preflight.sh                # 배포 전 전수검사
    ├── deploy-dev.sh
    └── deploy-prod.sh

grimoire-web/
├── Makefile                        # 진입점 (동일 인터페이스)
└── scripts/
    ├── deploy-common.sh
    ├── preflight.sh
    ├── deploy-dev.sh
    └── deploy-prod.sh
```

### Makefile 타겟

```bash
make preflight ENV=dev         # 배포 전수검사만 (배포 안 함)
make preflight ENV=prod

make deploy-dev                # preflight + 이미지 빌드 + 푸시 + Cloud Run 업데이트 + revision Ready 검증 + purge
make deploy-prod

make logs ENV=dev              # Cloud Run 로그 tail
make logs ENV=prod

make rollback ENV=prod SHA=<sha>   # 특정 SHA로 되돌림
```

### preflight 전수검사 항목

배포 스크립트는 실행 시작 시 `preflight.sh`를 **반드시 호출**한다. 하나라도 실패하면 배포는 `exit 1`로 중단된다.

1. **git 상태 검증**
   - 현재 브랜치가 배포 대상 브랜치(`develop`/`main`)와 일치
   - 워킹 트리에 스테이지/언스테이지된 변경 없음 (`git status --porcelain`이 비어 있음)
   - 로컬 HEAD가 `origin/{브랜치}` HEAD와 일치 (앞섰거나 밀렸으면 거부)

2. **gcloud CLI 상태**
   - `gcloud config list` 로 project=`grimoire-491708` 정합
   - `gcloud auth list` 로 active account 존재 (토큰 유효)

3. **Artifact Registry 접근**
   - `gcloud auth configure-docker asia-northeast1-docker.pkg.dev` 통과 (또는 1회 사전 설정 정합)
   - repo `grimoire-docker` 푸시 권한 (write) 확인

4. **Cloud Run 서비스 존재 + 프로젝트/리전 일치**
   - 타겟 Cloud Run 서비스가 `grimoire-491708` / `asia-northeast1`에 존재
   - 현 URL이 매트릭스와 일치

5. **Docker daemon**
   - `docker info` 성공
   - `docker buildx ls`에서 `linux/amd64` 지원 확인

6. **환경변수 존재 검증 (Cloud Run)**
   - server: `DATABASE_URL`(Secret), `JWT_SECRET`(Secret), `CORS_ORIGIN`, `POLAR_ACCESS_TOKEN`(Secret), `POLAR_WEBHOOK_SECRET`(Secret) 모두 설정됨
   - web: `API_URL`, `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` 설정됨
   - (값은 직접 출력하지 않음 — 존재 여부만)

7. **prod에 한해 추가 검증**
   - 마지막 커밋 메시지에 `feat:`/`fix:`/`merge:` 중 하나로 시작하는지 (규약)
   - 현재 브랜치가 정확히 `main`
   - 사용자에게 "prod 배포 맞습니까? (yes 입력)" 명시적 확인 (interactive)

8. **원격 DB와의 DB 스키마 일관성**
   - server 배포일 때만: Cloud SQL Auth Proxy spawn 후 `prisma migrate status --schema prisma/schema.prisma` 실행
   - 미적용 마이그레이션 있으면 **경고만** 출력 (배포는 진행) — 배포 후 앱 기동 시 `RUN_MIGRATION=true`가 자동 적용하므로

---

## 5. 배포 절차 (권장)

### 4.1 dev 배포
```bash
# grimoire-server
cd grimoire-server
make deploy-dev

# grimoire-web
cd grimoire-web
make deploy-dev

# 검증
curl -I https://dev-api.grimoire-book.com/api/health   # 200 기대
open https://dev.grimoire-book.com                     # 수동 UI 검증
```

### 4.2 prod 승격 (develop → main 직결)

```bash
# 2개 레포 각각
cd grimoire-server && git checkout main && git merge develop --no-ff -m "merge: develop → main" && git push origin main && git checkout develop
cd grimoire-web    && git checkout main && git merge develop --no-ff -m "merge: develop → main" && git push origin main && git checkout develop

# 배포 (interactive 확인 필수)
cd grimoire-server && make deploy-prod
cd grimoire-web    && make deploy-prod

# 검증
curl -I https://api.grimoire-book.com/api/health
open https://grimoire-book.com
```

> QA는 `develop` 브랜치에서 `make deploy-dev` 후 dev URL로 진행한다. (기존 inhouse 흡수)

---

## 6. 롤백

```bash
# Artifact Registry에 쌓인 이미지 목록 (최신 30개 중 prod 필터)
gcloud artifacts docker tags list \
  asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-server \
  --sort-by="~CREATE_TIME" --limit=30 \
  --format="value(TAG)" | grep "^prod-" | head

# 특정 SHA로 되돌림 (Cloud Run revision 갱신)
make rollback ENV=prod SHA=abc1234...
```

스크립트는 해당 SHA 태그가 Artifact Registry에 존재하는지 먼저 확인한다 (`gcloud artifacts docker images describe`).

대안 — Cloud Run revision 직접 트래픽 전환:

```bash
# revision 목록
gcloud run revisions list --service grimoire-server-prod --region asia-northeast1

# 특정 revision으로 100% 트래픽 전환 (즉시 롤백)
gcloud run services update-traffic grimoire-server-prod \
  --region asia-northeast1 \
  --to-revisions grimoire-server-prod-00003-5nl=100
```

---

## 7. 환경변수 추가/변경

> **스크립트는 이미지 배포만 담당한다**. 환경변수 변경은 별도 명령으로 수행한다.
> 비밀값은 Secret Manager 단일 진실 — Cloud Run env로 `--update-secrets` 바인딩.

```bash
# 평문 변수 (공개 안전)
gcloud run services update grimoire-server-dev \
  --region asia-northeast1 \
  --update-env-vars POLAR_SERVER=production,APP_ENV=development

# Secret Manager 바인딩 (비밀값)
gcloud run services update grimoire-server-dev \
  --region asia-northeast1 \
  --update-secrets DATABASE_URL=database-url-authproxy-dev-an1:latest,JWT_SECRET=jwt-secret-dev-an1:latest

# Secret 새 version 추가 (값 회전)
echo -n "<MASKED>" | gcloud secrets versions add jwt-secret-dev-an1 --data-file=-
# → Cloud Run 서비스가 :latest 참조 시 자동 적용 (다음 revision부터)
```

환경변수 변경이 있었다면 **반드시** `INFRASTRUCTURE.md §3/§9`와 이 문서 §1 매트릭스를 같은 커밋에 업데이트한다.

---

## 8. 보안 주의

이 문서와 스크립트는 **비밀값 자체를 커밋에 포함하지 않는다**. 모든 자격증명은:

- gcloud 자격증명: `gcloud auth login`으로 로컬 keychain에 저장
- Artifact Registry 자격증명: `gcloud auth configure-docker` (Application Default Credentials 위임, 만료 자동 갱신)
- 앱 런타임 시크릿: **Secret Manager에만 존재** (Cloud Run env가 `--set-secrets`로 바인딩). `.env`에는 **로컬 전용 값만**

자세한 보안 지침: `SECURITY.md §4 배포 전 체크리스트` + `INFRASTRUCTURE.md §8 보안 체크리스트` 참조.

---

## 9. CI 복원 시 (GCP Actions 정합)

GitHub Actions 빌링이 복구되면 자동 배포가 다시 작동한다. 그 경우에도:

- **수동 배포는 긴급 수단으로 계속 유지**한다 (운영자가 로컬에서 언제든 실행 가능해야 함)
- 스크립트가 업데이트되면 `.github/workflows/deploy-*.yml`도 동일한 로직으로 업데이트한다 (현재 `.disabled` 상태)
- 스크립트가 정본이 되도록 관리한다 (CI는 스크립트를 호출하는 래퍼로 전환 가능)

### GCP Actions 정합 (deploy-*.yml.disabled 갱신 시 참조)

```yaml
# 인증
- uses: google-github-actions/auth@v2
  with:
    credentials_json: ${{ secrets.GCP_SA_KEY }}

# Artifact Registry login
- run: gcloud auth configure-docker asia-northeast1-docker.pkg.dev

# Cloud Run deploy
- run: |
    gcloud run deploy grimoire-server-${{ env.ENV }} \
      --region asia-northeast1 \
      --image asia-northeast1-docker.pkg.dev/grimoire-491708/grimoire-docker/grimoire-server:${{ env.ENV }}-${{ github.sha }} \
      --add-cloudsql-instances grimoire-491708:asia-northeast1:grimoire-db-${{ env.ENV }}
```

> 현재 `db-sync-nightly.yml` (수동 트리거 + 자정 스케줄)만 활성 상태. deploy-*.yml은 빌링 복구 + 검토 후 활성화 예정.

---

## 10. 참조 문서

- `INFRASTRUCTURE.md` — GCP 인프라 구성 (Cloud Run + Cloud SQL + Artifact Registry + GCS)
- `SECURITY.md` — 보안 정책 + 배포 전 체크리스트
- `docs/environments.md` — 환경 정본
- `MIGRATION.md` — DB 마이그레이션 규칙 (Cloud SQL Auth Proxy 사용)
- `CLAUDE.md §11 전수검사` — 배포 전 체크리스트
- 루트 `CLAUDE.md §7 빌드 환경`, `§8 Git 브랜치 전략`
