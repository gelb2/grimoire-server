#!/usr/bin/env bash
# deploy-common.sh — grimoire-server 배포 공통 상수/함수
# 모든 deploy-*.sh, preflight.sh가 source로 로드한다.
# 정본: docs/DEPLOY.md §1 환경 매트릭스
#
# 이 파일을 변경하면 반드시 docs/DEPLOY.md §1 매트릭스를 함께 갱신한다.
#
# 2026-06-10 GCP 전환: Azure(az containerapp / ACR / zenith-rg) → GCP(Cloud Run / Artifact
#   Registry / grimoire-491708). 5/27 GCP 마이그레이션 당시 deploy 경로(이 파일 +
#   deploy-{dev,prod}.sh + preflight.sh)는 Azure 그대로 남아 있었고, 6/4 Azure decommission
#   (zenith-rg 삭제)으로 무력화 → 본 전환으로 복구. db-sync-remote.sh가 의존하는 로깅
#   유틸 5종(info/ok/warn/fail/step)은 시그니처·동작 무변경(이 파일에서 db-sync로 source됨).

set -u   # 미정의 변수 참조 시 에러
# set -e는 스크립트 본체에서 켠다 (함수 실패 처리 세밀화 위해 여기선 꺼둠)

# ─────────────────────────────────────────────────────────────
# 공통 상수 (매트릭스) — GCP (docs/DEPLOY.md §1 실측 기준)
# ─────────────────────────────────────────────────────────────
readonly GCP_PROJECT_ID="grimoire-491708"
readonly GCP_PROJECT_NUMBER="23295981916"
readonly GCP_REGION="asia-northeast1"
readonly ARTIFACT_REGISTRY_HOST="asia-northeast1-docker.pkg.dev"
readonly ARTIFACT_REPO="grimoire-docker"
readonly ARTIFACT_REPO_FQ="${ARTIFACT_REGISTRY_HOST}/${GCP_PROJECT_ID}/${ARTIFACT_REPO}"
readonly IMAGE_REPO="grimoire-server"
readonly BUILD_PLATFORM="linux/amd64"
# Cloud Run 공개 URL pattern: https://grimoire-{server,web}-{env}-tolwmynw6a-an.a.run.app
readonly CLOUD_RUN_URL_SUFFIX="tolwmynw6a-an.a.run.app"
readonly IMAGE_KEEP_COUNT=5
readonly EXPECTED_GCP_ACCOUNT="rainmaker8492@gmail.com"
# Cloud Run 서비스 계정 (기본 compute SA)
readonly CLOUD_RUN_SA="${GCP_PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
# Cloud Run 컨테이너 포트 (server)
readonly CONTAINER_PORT=3000

# ─────────────────────────────────────────────────────────────
# 색상 출력 유틸
# ─────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  readonly C_RED=$'\033[0;31m'
  readonly C_GREEN=$'\033[0;32m'
  readonly C_YELLOW=$'\033[0;33m'
  readonly C_BLUE=$'\033[0;34m'
  readonly C_BOLD=$'\033[1m'
  readonly C_OFF=$'\033[0m'
else
  readonly C_RED=""; readonly C_GREEN=""; readonly C_YELLOW=""; readonly C_BLUE=""; readonly C_BOLD=""; readonly C_OFF=""
fi

info() { printf "%s[INFO]%s %s\n" "$C_BLUE" "$C_OFF" "$*"; }
ok()   { printf "%s[ OK ]%s %s\n" "$C_GREEN" "$C_OFF" "$*"; }
warn() { printf "%s[WARN]%s %s\n" "$C_YELLOW" "$C_OFF" "$*" >&2; }
fail() { printf "%s[FAIL]%s %s\n" "$C_RED" "$C_OFF" "$*" >&2; exit 1; }
step() { printf "\n%s▶ %s%s\n" "$C_BOLD" "$*" "$C_OFF"; }

# ─────────────────────────────────────────────────────────────
# 환경 매트릭스 (값 조회 함수)
# ─────────────────────────────────────────────────────────────

# 유효한 ENV인지 검증 (2026-04-19 inhouse 제거 — 2환경만 유지)
validate_env() {
  case "${1:-}" in
    dev|prod) return 0 ;;
    *) fail "ENV must be one of: dev, prod (got: '${1:-}')" ;;
  esac
}

# ENV → git 브랜치
env_to_branch() {
  case "$1" in
    dev) echo "develop" ;;
    prod) echo "main" ;;
    *) return 1 ;;
  esac
}

# ENV → Cloud Run 서비스 이름 (server)
env_to_app_name() {
  case "$1" in
    dev) echo "grimoire-server-dev" ;;
    prod) echo "grimoire-server-prod" ;;
    *) return 1 ;;
  esac
}

# ENV → Cloud Run 자동 발급 공개 URL (도메인 매핑 외 직접 접근용)
env_to_run_url() {
  case "$1" in
    dev) echo "https://grimoire-server-dev-${CLOUD_RUN_URL_SUFFIX}" ;;
    prod) echo "https://grimoire-server-prod-${CLOUD_RUN_URL_SUFFIX}" ;;
    *) return 1 ;;
  esac
}

# ENV → public API URL (커스텀 도메인)
env_to_public_api_url() {
  case "$1" in
    dev) echo "https://dev-api.grimoire-book.com" ;;
    prod) echo "https://api.grimoire-book.com" ;;
    *) return 1 ;;
  esac
}

# ENV → Cloud SQL connection name
env_to_cloudsql_instance() {
  case "$1" in
    dev) echo "${GCP_PROJECT_ID}:${GCP_REGION}:grimoire-db-dev" ;;
    prod) echo "${GCP_PROJECT_ID}:${GCP_REGION}:grimoire-db-prod" ;;
    *) return 1 ;;
  esac
}

# ENV → 이미지 태그 prefix
env_to_tag_prefix() {
  case "$1" in
    dev) echo "dev" ;;
    prod) echo "prod" ;;
    *) return 1 ;;
  esac
}

# ─────────────────────────────────────────────────────────────
# 공용 헬퍼 함수
# ─────────────────────────────────────────────────────────────

# 현재 git HEAD SHA (full 40자)
current_sha() {
  git rev-parse HEAD
}

# 현재 git 브랜치
current_branch() {
  git rev-parse --abbrev-ref HEAD
}

# 매트릭스 출력
print_matrix() {
  local env="$1"
  info "대상 환경: $env"
  info "  브랜치:        $(env_to_branch "$env")"
  info "  Cloud Run:     $(env_to_app_name "$env")"
  info "  공개 URL(run): $(env_to_run_url "$env")"
  info "  공개 API URL:  $(env_to_public_api_url "$env")"
  info "  Cloud SQL:     $(env_to_cloudsql_instance "$env")"
  info "  태그 prefix:   $(env_to_tag_prefix "$env")-"
}

# 이미지 FQ 태그 (SHA)
image_fq_sha() {
  local env="$1" sha="$2"
  echo "${ARTIFACT_REPO_FQ}/${IMAGE_REPO}:$(env_to_tag_prefix "$env")-${sha}"
}

# 이미지 FQ 태그 (latest)
image_fq_latest() {
  local env="$1"
  echo "${ARTIFACT_REPO_FQ}/${IMAGE_REPO}:$(env_to_tag_prefix "$env")-latest"
}

# ─────────────────────────────────────────────────────────────
# 배포 액션 함수 (스크립트에서 호출)
# ─────────────────────────────────────────────────────────────

# Artifact Registry Docker 인증.
# 기존 az acr login 대체. ADC 위임 — 만료 자동 갱신.
# docs/DEPLOY.md §3.1 (osxkeychain credsStore 전제).
action_acr_login() {
  step "Artifact Registry Docker 인증"
  gcloud auth configure-docker "$ARTIFACT_REGISTRY_HOST" --quiet >/dev/null 2>&1 \
    || fail "Artifact Registry 인증 실패. 'gcloud auth login' 후 재시도."
  ok "Artifact Registry 인증 완료 ($ARTIFACT_REGISTRY_HOST)"
}

action_docker_build_push() {
  local env="$1" sha="$2"
  local tag_sha tag_latest
  tag_sha="$(image_fq_sha "$env" "$sha")"
  tag_latest="$(image_fq_latest "$env")"

  step "Docker 이미지 빌드 (platform=$BUILD_PLATFORM)"
  info "  태그: $tag_sha"
  info "  태그: $tag_latest"

  docker build --platform "$BUILD_PLATFORM" \
    -t "$tag_sha" \
    -t "$tag_latest" \
    . || fail "docker build 실패"
  ok "빌드 완료"

  step "이미지 푸시"
  docker push "$tag_sha" || fail "docker push ($tag_sha) 실패"
  docker push "$tag_latest" || fail "docker push ($tag_latest) 실패"
  ok "푸시 완료"
}

# Cloud Run 서비스 업데이트 (이미지 교체).
# 기존 az containerapp update 대체.
# gcloud run deploy --image 는 env/secret/scale 등 기존 revision 템플릿 형상을 보존하고
#   이미지만 교체한다(Azure containerapp update --image 와 동일 동작). cloudsql/SA/port 는
#   안전을 위해 명시적으로 재지정한다(Step1 실측 형상 재현).
# 배포 직후 생성된 신규 revision 이름을 전역 변수 DEPLOYED_REVISION 에 박제한다.
# (revision-aware healthcheck 가 이 값을 사용 — endpoint 200 ≠ 신규 revision Ready 차단)
action_containerapp_update() {
  local env="$1" sha="$2"
  local app tag_sha cloudsql
  app="$(env_to_app_name "$env")"
  tag_sha="$(image_fq_sha "$env" "$sha")"
  cloudsql="$(env_to_cloudsql_instance "$env")"

  step "Cloud Run 업데이트: $app"
  info "  이미지: $tag_sha"
  info "  Cloud SQL: $cloudsql"
  # deploy 응답 JSON 에서 신규 revision 이름 캡처.
  # --image 만 주면 기존 env/secret/scale 형상 보존. cloudsql/SA/port 는 명시 재지정.
  local deploy_out
  deploy_out=$(gcloud run deploy "$app" \
    --image "$tag_sha" \
    --region "$GCP_REGION" \
    --project "$GCP_PROJECT_ID" \
    --service-account "$CLOUD_RUN_SA" \
    --add-cloudsql-instances "$cloudsql" \
    --port "$CONTAINER_PORT" \
    --quiet \
    --format json 2>/dev/null) || fail "Cloud Run 업데이트 실패"

  DEPLOYED_REVISION=$(printf "%s" "$deploy_out" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',{}).get('latestCreatedRevisionName',''))" 2>/dev/null || echo "")

  # deploy 응답에서 못 얻으면 revisions list 로 폴백 (최신 createTimestamp 기준)
  if [ -z "$DEPLOYED_REVISION" ]; then
    DEPLOYED_REVISION=$(gcloud run revisions list \
      --service "$app" \
      --region "$GCP_REGION" \
      --project "$GCP_PROJECT_ID" \
      --sort-by="~metadata.creationTimestamp" \
      --limit 1 \
      --format="value(metadata.name)" 2>/dev/null || echo "")
  fi

  if [ -z "$DEPLOYED_REVISION" ]; then
    warn "신규 revision 이름 캡처 실패 — revision-aware healthcheck 가 폴백 모드로 동작"
  else
    info "  신규 revision: $DEPLOYED_REVISION"
  fi
  ok "업데이트 완료"
}

# revision-aware healthcheck — 신규 revision 의 Ready 컨디션 직접 검증.
# 배경: 신규 revision 이 startup 실패하면 Cloud Run 은 직전 healthy revision 으로 트래픽을
#       유지(rollback) → endpoint 는 200(구 코드)이지만 신규 revision 은 죽음.
#       endpoint curl 만으로는 이 사고를 잡지 못한다(Azure 시절 2026-05-15 server-dev rev159 동형).
# 판정 (Cloud Run revision status.conditions[type=Ready]):
#   - Ready == True                          → 성공
#   - Ready == False                         → 실패 (비0 exit) — startup/health 실패
#   - Ready == Unknown (reason=Deploying 등)  → 안정화 대기 (polling 계속)
# polling: 30s 간격 최대 5회 (총 ~150s).
action_post_deploy_revision_check() {
  local env="$1"
  local app
  app="$(env_to_app_name "$env")"

  step "Healthcheck (신규 revision 상태 직접 검증)"

  local rev="${DEPLOYED_REVISION:-}"
  if [ -z "$rev" ]; then
    # update 단계에서 캡처 실패 → 폴백: 최신 revision 재조회
    rev=$(gcloud run revisions list \
      --service "$app" \
      --region "$GCP_REGION" \
      --project "$GCP_PROJECT_ID" \
      --sort-by="~metadata.creationTimestamp" \
      --limit 1 \
      --format="value(metadata.name)" 2>/dev/null || echo "")
    if [ -z "$rev" ]; then
      fail "신규 revision 이름을 확정할 수 없음 — 배포 검증 불가."
    fi
    warn "DEPLOYED_REVISION 미설정 — 폴백으로 최신 revision '$rev' 검증"
  fi
  info "  검증 대상 revision: $rev"

  local i=0 max=5 ready="" reason="" rev_json=""
  while [ "$i" -lt "$max" ]; do
    # status.conditions 에서 type=Ready 의 status/reason 추출
    # gcloud run revisions describe 는 revision 이름만으로 조회한다.
    # --service 플래그 미지원 (gcloud: unrecognized arguments) → rev_json 공백 → 거짓 FAIL.
    # (revisions list 는 --service 정상 지원하므로 별개로 유지.)
    rev_json=$(gcloud run revisions describe "$rev" \
      --region "$GCP_REGION" \
      --project "$GCP_PROJECT_ID" \
      --format=json 2>/dev/null || echo "")

    if [ -z "$rev_json" ]; then
      info "  revision 조회 실패. 30초 후 재시도 ($((i+1))/$max)"
      sleep 30
      i=$((i+1))
      continue
    fi

    ready=$(printf "%s" "$rev_json" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for c in d.get('status',{}).get('conditions',[]):
    if c.get('type')=='Ready':
        print(c.get('status','')); break
" 2>/dev/null || echo "")
    reason=$(printf "%s" "$rev_json" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for c in d.get('status',{}).get('conditions',[]):
    if c.get('type')=='Ready':
        print(c.get('reason','') or c.get('message','')[:80]); break
" 2>/dev/null || echo "")
    info "  revision 상태: Ready=$ready reason=$reason ($((i+1))/$max)"

    # 즉시 실패 판정 — polling 중단
    if [ "$ready" = "False" ]; then
      fail "신규 revision '$rev' Ready=False (reason=$reason) — 배포 실패. (endpoint 200 은 직전 revision fallback)
  → 회복: make rollback ENV=$env SHA=<last-healthy-sha>
  → 또는: gcloud run services update-traffic $app --region $GCP_REGION --to-revisions <last-healthy-revision>=100
  → 또는: rollback-revision skill 호출"
    fi

    # 성공 판정
    if [ "$ready" = "True" ]; then
      ok "신규 revision '$rev' 정상 (Ready=True)"
      return 0
    fi

    # Unknown(Deploying 등) — 안정화 대기
    info "  안정화 대기 중. 30초 후 재검증 ($((i+1))/$max)"
    sleep 30
    i=$((i+1))
  done

  # max 회 polling 후에도 Ready=True 미도달
  fail "신규 revision '$rev' 가 ${max}회 polling(약 150s) 후에도 Ready 미도달 (최종: Ready=$ready reason=$reason) — 배포 실패."
}

# 오래된 이미지 정리 (Artifact Registry).
# 기존 az acr repository delete 대체.
# {prefix}-{sha} 태그를 시간 오름차순으로 보고 최근 IMAGE_KEEP_COUNT 개만 유지.
# {prefix}-latest 편의 태그는 건너뜀.
action_purge_old_images() {
  local env="$1"
  local prefix
  prefix="$(env_to_tag_prefix "$env")-"

  step "오래된 이미지 정리 ($prefix 최근 $IMAGE_KEEP_COUNT 개만 유지)"
  # 시간 오름차순(오래된 것부터). prefix 매칭 + latest 제외.
  local image_path tags total_count delete_count
  image_path="${ARTIFACT_REPO_FQ}/${IMAGE_REPO}"
  tags=$(gcloud artifacts docker tags list "$image_path" \
    --project "$GCP_PROJECT_ID" \
    --sort-by="CREATE_TIME" \
    --format="value(TAG)" 2>/dev/null \
    | grep "^${prefix}" | grep -v "^${prefix}latest$" || echo "")

  if [ -z "$tags" ]; then
    info "  태그 없음. 스킵."
    return 0
  fi

  total_count=$(printf "%s\n" "$tags" | grep -c . | tr -d ' ')
  delete_count=$((total_count - IMAGE_KEEP_COUNT))

  if [ "$delete_count" -le 0 ]; then
    info "  유지 개수 이하 ($total_count / $IMAGE_KEEP_COUNT). 스킵."
    return 0
  fi

  info "  $delete_count 개 삭제 예정 (전체 $total_count 개)"
  printf "%s\n" "$tags" | head -n "$delete_count" | while read -r TAG; do
    [ -z "$TAG" ] && continue
    info "  삭제: $TAG"
    # 태그 삭제 (이미지 매니페스트가 다른 태그에서 안 쓰이면 GC 대상)
    gcloud artifacts docker tags delete "${image_path}:${TAG}" \
      --project "$GCP_PROJECT_ID" \
      --quiet >/dev/null 2>&1 || warn "삭제 실패: $TAG"
  done
  ok "정리 완료"
}

# endpoint curl healthcheck — 보조 검증.
# 주의: 이 검증만으로는 신규 revision startup 실패를 잡지 못한다 (직전 revision fallback 200).
#       반드시 action_post_deploy_revision_check 를 먼저 통과시킨 뒤 보조로 호출할 것.
action_post_deploy_healthcheck() {
  local env="$1"
  local url
  # 커스텀 도메인(api.grimoire-book.com)으로 보조 검증
  url="$(env_to_public_api_url "$env")/api/health"

  step "Healthcheck (endpoint 보조 검증)"
  info "  GET $url"

  # Cloud Run cold start 감안 — 최대 60초 대기
  local i=0 status=""
  while [ "$i" -lt 12 ]; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [ "$status" = "200" ]; then
      ok "200 OK ($(date +%H:%M:%S))"
      return 0
    fi
    info "  상태: $status. 5초 후 재시도 ($((i+1))/12)"
    sleep 5
    i=$((i+1))
  done
  fail "Healthcheck 실패 (최종 상태: $status)"
}
