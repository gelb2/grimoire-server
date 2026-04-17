#!/usr/bin/env bash
# deploy-common.sh — grimoire-server 배포 공통 상수/함수
# 모든 deploy-*.sh, preflight.sh가 source로 로드한다.
# 정본: docs/DEPLOY.md §1 환경 매트릭스
#
# 이 파일을 변경하면 반드시 docs/DEPLOY.md §1 매트릭스를 함께 갱신한다.

set -u   # 미정의 변수 참조 시 에러
# set -e는 스크립트 본체에서 켠다 (함수 실패 처리 세밀화 위해 여기선 꺼둠)

# ─────────────────────────────────────────────────────────────
# 공통 상수 (매트릭스)
# ─────────────────────────────────────────────────────────────
readonly RESOURCE_GROUP="zenith-rg"
readonly ACR_NAME="grimoireacr"
readonly ACR_LOGIN_SERVER="grimoireacr.azurecr.io"
readonly IMAGE_REPO="grimoire-server"
readonly BUILD_PLATFORM="linux/amd64"
readonly FQDN_SUFFIX="salmonsmoke-9e462011.koreacentral.azurecontainerapps.io"
readonly IMAGE_KEEP_COUNT=5
readonly EXPECTED_AZURE_USER="rainmaker8492@gmail.com"

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

# 유효한 ENV인지 검증
validate_env() {
  case "${1:-}" in
    dev|inhouse|prod) return 0 ;;
    *) fail "ENV must be one of: dev, inhouse, prod (got: '${1:-}')" ;;
  esac
}

# ENV → git 브랜치
env_to_branch() {
  case "$1" in
    dev) echo "develop" ;;
    inhouse) echo "inhouse" ;;
    prod) echo "main" ;;
    *) return 1 ;;
  esac
}

# ENV → Container App 이름 (server)
env_to_app_name() {
  case "$1" in
    dev) echo "grimoire-server-dev" ;;
    inhouse) echo "grimoire-server-inhouse" ;;
    prod) echo "grimoire-server-prod" ;;
    *) return 1 ;;
  esac
}

# ENV → Container App FQDN
env_to_fqdn() {
  case "$1" in
    dev) echo "grimoire-server-dev.${FQDN_SUFFIX}" ;;
    inhouse) echo "grimoire-server-inhouse.${FQDN_SUFFIX}" ;;
    prod) echo "grimoire-server-prod.${FQDN_SUFFIX}" ;;
    *) return 1 ;;
  esac
}

# ENV → public API URL (커스텀 도메인)
env_to_public_api_url() {
  case "$1" in
    dev) echo "https://dev-api.grimoire-book.com" ;;
    inhouse) echo "https://inhouse-api.grimoire-book.com" ;;
    prod) echo "https://api.grimoire-book.com" ;;
    *) return 1 ;;
  esac
}

# ENV → 이미지 태그 prefix
env_to_tag_prefix() {
  case "$1" in
    dev) echo "dev" ;;
    inhouse) echo "inhouse" ;;
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
  info "  브랜치:       $(env_to_branch "$env")"
  info "  Container App: $(env_to_app_name "$env")"
  info "  FQDN:         https://$(env_to_fqdn "$env")"
  info "  공개 API URL: $(env_to_public_api_url "$env")"
  info "  태그 prefix:   $(env_to_tag_prefix "$env")-"
}

# 이미지 FQ 태그 (SHA)
image_fq_sha() {
  local env="$1" sha="$2"
  echo "${ACR_LOGIN_SERVER}/${IMAGE_REPO}:$(env_to_tag_prefix "$env")-${sha}"
}

# 이미지 FQ 태그 (latest)
image_fq_latest() {
  local env="$1"
  echo "${ACR_LOGIN_SERVER}/${IMAGE_REPO}:$(env_to_tag_prefix "$env")-latest"
}

# ─────────────────────────────────────────────────────────────
# 배포 액션 함수 (스크립트에서 호출)
# ─────────────────────────────────────────────────────────────

action_acr_login() {
  step "ACR 로그인"
  az acr login --name "$ACR_NAME" >/dev/null 2>&1 || fail "ACR 로그인 실패. 'az login' 후 재시도."
  ok "ACR 로그인 완료"
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

action_containerapp_update() {
  local env="$1" sha="$2"
  local app tag_sha
  app="$(env_to_app_name "$env")"
  tag_sha="$(image_fq_sha "$env" "$sha")"

  step "Container App 업데이트: $app"
  info "  이미지: $tag_sha"
  az containerapp update \
    --name "$app" \
    --resource-group "$RESOURCE_GROUP" \
    --image "$tag_sha" \
    -o none || fail "Container App 업데이트 실패"
  ok "업데이트 완료"
}

action_purge_old_images() {
  local env="$1"
  local prefix
  prefix="$(env_to_tag_prefix "$env")-"

  step "오래된 이미지 정리 ($prefix 최근 $IMAGE_KEEP_COUNT 개만 유지)"
  # 시간 오름차순(오래된 것부터). *-latest 태그는 건너뜀.
  local tags total_count delete_count
  tags=$(az acr repository show-tags \
    --name "$ACR_NAME" \
    --repository "$IMAGE_REPO" \
    --orderby time_asc \
    --query "[?starts_with(@, '${prefix}') && @!='${prefix}latest']" \
    -o tsv 2>/dev/null || echo "")

  if [ -z "$tags" ]; then
    info "  태그 없음. 스킵."
    return 0
  fi

  total_count=$(printf "%s\n" "$tags" | wc -l | tr -d ' ')
  delete_count=$((total_count - IMAGE_KEEP_COUNT))

  if [ "$delete_count" -le 0 ]; then
    info "  유지 개수 이하 ($total_count / $IMAGE_KEEP_COUNT). 스킵."
    return 0
  fi

  info "  $delete_count 개 삭제 예정 (전체 $total_count 개)"
  printf "%s\n" "$tags" | head -n "$delete_count" | while read -r TAG; do
    [ -z "$TAG" ] && continue
    info "  삭제: $TAG"
    az acr repository delete \
      --name "$ACR_NAME" \
      --image "${IMAGE_REPO}:${TAG}" \
      --yes >/dev/null 2>&1 || warn "삭제 실패: $TAG"
  done
  ok "정리 완료"
}

action_post_deploy_healthcheck() {
  local env="$1"
  local fqdn
  fqdn="$(env_to_fqdn "$env")"

  step "Healthcheck (Container App 직접)"
  local url="https://${fqdn}/api/health"
  info "  GET $url"

  # Container App cold start 감안 — 최대 60초 대기
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
