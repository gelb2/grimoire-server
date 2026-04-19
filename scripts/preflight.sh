#!/usr/bin/env bash
# preflight.sh — 배포 전 전수검사 (grimoire-server)
# 사용: ./scripts/preflight.sh <env>
#   <env>: dev | prod
# 정본: docs/DEPLOY.md §3 preflight 전수검사 항목
#
# 모든 검사 통과 → exit 0
# 하나라도 실패 → 검사 목록 출력 후 exit 1

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./deploy-common.sh
source "${SCRIPT_DIR}/deploy-common.sh"

ENV="${1:-}"
validate_env "$ENV"

# 체크 결과 추적 (bash 3.2 호환 — associative array 미사용)
CHECK_FAILED=0
CHECK_WARNS=0

check_pass() { ok "$*"; }
check_fail() { fail_check() { printf "%s[FAIL]%s %s\n" "$C_RED" "$C_OFF" "$*" >&2; }; fail_check "$@"; CHECK_FAILED=$((CHECK_FAILED+1)); }
check_warn() { warn "$*"; CHECK_WARNS=$((CHECK_WARNS+1)); }

# 편의 래퍼
_fail() { printf "%s[FAIL]%s %s\n" "$C_RED" "$C_OFF" "$*" >&2; CHECK_FAILED=$((CHECK_FAILED+1)); }
_pass() { printf "%s[PASS]%s %s\n" "$C_GREEN" "$C_OFF" "$*"; }
_warn() { printf "%s[WARN]%s %s\n" "$C_YELLOW" "$C_OFF" "$*" >&2; CHECK_WARNS=$((CHECK_WARNS+1)); }

printf "\n%s╔══ grimoire-server preflight [%s] ══╗%s\n" "$C_BOLD" "$ENV" "$C_OFF"
print_matrix "$ENV"

# ─────────────────────────────────────────────────────────────
# 1. git 상태
# ─────────────────────────────────────────────────────────────
step "1/8: git 상태"
EXPECTED_BRANCH=$(env_to_branch "$ENV")
CURRENT_BRANCH=$(current_branch)
if [ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]; then
  _fail "현재 브랜치 '$CURRENT_BRANCH' ≠ 기대 브랜치 '$EXPECTED_BRANCH'"
else
  _pass "현재 브랜치: $CURRENT_BRANCH"
fi

if [ -n "$(git status --porcelain)" ]; then
  _fail "워킹 트리에 스테이지/언스테이지된 변경 있음. 커밋하거나 stash 후 재시도."
  git status --short
else
  _pass "워킹 트리 클린"
fi

# 원격과의 동기화 확인
git fetch origin "$EXPECTED_BRANCH" --quiet 2>/dev/null || _warn "git fetch 실패 (네트워크?)"
LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null || echo "none")
REMOTE_SHA=$(git rev-parse "origin/${EXPECTED_BRANCH}" 2>/dev/null || echo "none")
if [ "$LOCAL_SHA" = "none" ] || [ "$REMOTE_SHA" = "none" ]; then
  _warn "git SHA 비교 불가"
elif [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  _fail "로컬 HEAD($LOCAL_SHA)와 origin/${EXPECTED_BRANCH}($REMOTE_SHA) 불일치. push 누락 또는 pull 필요."
else
  _pass "로컬 HEAD == origin/${EXPECTED_BRANCH} ($LOCAL_SHA)"
fi

# ─────────────────────────────────────────────────────────────
# 2. Azure CLI 상태
# ─────────────────────────────────────────────────────────────
step "2/8: Azure CLI 로그인 상태"
if ! az account show -o json >/dev/null 2>&1; then
  _fail "Azure CLI 로그인되어 있지 않음. 'az login' 실행 필요."
else
  AZ_USER=$(az account show --query "user.name" -o tsv 2>/dev/null)
  if [ "$AZ_USER" != "$EXPECTED_AZURE_USER" ]; then
    _fail "Azure 로그인 사용자 '$AZ_USER' ≠ 기대 '$EXPECTED_AZURE_USER'"
  else
    _pass "Azure 로그인: $AZ_USER"
  fi
fi

# ─────────────────────────────────────────────────────────────
# 3. ACR 접근
# ─────────────────────────────────────────────────────────────
step "3/8: ACR 접근"
if ! az acr show --name "$ACR_NAME" -o none 2>/dev/null; then
  _fail "ACR '$ACR_NAME' 접근 불가 (권한 또는 존재 확인 필요)"
else
  _pass "ACR '$ACR_NAME' 접근 가능"
fi

# ─────────────────────────────────────────────────────────────
# 4. Container App 존재 + 리소스그룹 일치
# ─────────────────────────────────────────────────────────────
step "4/8: Container App 존재 확인"
APP_NAME=$(env_to_app_name "$ENV")
APP_INFO=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" -o json 2>/dev/null || echo "")
if [ -z "$APP_INFO" ]; then
  _fail "Container App '$APP_NAME' 이 '$RESOURCE_GROUP'에 없음"
else
  ACTUAL_FQDN=$(echo "$APP_INFO" | python3 -c "import sys,json;print(json.load(sys.stdin)['properties']['configuration']['ingress']['fqdn'])" 2>/dev/null || echo "unknown")
  EXPECTED_FQDN=$(env_to_fqdn "$ENV")
  if [ "$ACTUAL_FQDN" != "$EXPECTED_FQDN" ]; then
    _fail "FQDN 불일치: 실제 '$ACTUAL_FQDN' ≠ 기대 '$EXPECTED_FQDN'"
  else
    _pass "Container App '$APP_NAME' (FQDN: $EXPECTED_FQDN)"
  fi
fi

# ─────────────────────────────────────────────────────────────
# 5. Docker daemon
# ─────────────────────────────────────────────────────────────
step "5/8: Docker daemon"
if ! docker info >/dev/null 2>&1; then
  _fail "Docker daemon 미실행. Docker Desktop을 실행하세요."
else
  _pass "Docker daemon 실행 중"
  # buildx linux/amd64 지원 확인
  if docker buildx ls 2>/dev/null | grep -q "linux/amd64"; then
    _pass "linux/amd64 빌드 지원"
  else
    _warn "linux/amd64 빌드 지원 미확인 (buildx ls 실패). 계속 진행."
  fi
fi

# ─────────────────────────────────────────────────────────────
# 6. 필수 환경변수 존재 (Container App)
# ─────────────────────────────────────────────────────────────
step "6/8: Container App 필수 환경변수 존재 확인"
REQUIRED_KEYS=("DATABASE_URL" "JWT_SECRET" "CORS_ORIGIN" "APP_ENV" "POLAR_ACCESS_TOKEN" "POLAR_WEBHOOK_SECRET" "ANTHROPIC_API_KEY" "OPENAI_API_KEY" "AZURE_STORAGE_ACCOUNT_NAME" "AZURE_STORAGE_ACCOUNT_KEY")
ENV_KEYS=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.template.containers[0].env[].name" -o tsv 2>/dev/null || echo "")
for key in "${REQUIRED_KEYS[@]}"; do
  if echo "$ENV_KEYS" | grep -qw "$key"; then
    _pass "$key 설정됨"
  else
    _fail "$key 누락. az containerapp update --set-env-vars 로 설정 필요."
  fi
done

# ─────────────────────────────────────────────────────────────
# 7. CORS 정책 환경별 검증
# ─────────────────────────────────────────────────────────────
step "7/8: APP_ENV + CORS_ORIGIN 환경별 검증"
# APP_ENV 값 검증 (dev → development, prod → production) — 2026-04-19 inhouse 제거
ACTUAL_APP_ENV=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.template.containers[0].env[?name=='APP_ENV'].value" -o tsv 2>/dev/null || echo "")
EXPECTED_APP_ENV="$ENV"
if [ "$ENV" = "dev" ]; then EXPECTED_APP_ENV="development"; fi
if [ "$ENV" = "prod" ]; then EXPECTED_APP_ENV="production"; fi
if [ -z "$ACTUAL_APP_ENV" ]; then
  _fail "APP_ENV 누락. az containerapp update --set-env-vars APP_ENV=${EXPECTED_APP_ENV} 로 설정 필요."
elif [ "$ACTUAL_APP_ENV" != "$EXPECTED_APP_ENV" ]; then
  _fail "APP_ENV 불일치: 실제 '$ACTUAL_APP_ENV' ≠ 기대 '$EXPECTED_APP_ENV'"
else
  _pass "APP_ENV: $ACTUAL_APP_ENV"
fi


ACTUAL_CORS=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.template.containers[0].env[?name=='CORS_ORIGIN'].value" -o tsv 2>/dev/null || echo "")
case "$ENV" in
  dev)
    if [ "$ACTUAL_CORS" = "*" ]; then
      _warn "dev CORS=* (의도됨). 그러나 prod는 엄격해야 함."
    else
      _pass "dev CORS: $ACTUAL_CORS"
    fi
    ;;
  prod)
    if [ "$ACTUAL_CORS" = "https://grimoire-book.com" ]; then
      _pass "prod CORS 정확"
    elif [ "$ACTUAL_CORS" = "*" ]; then
      _fail "prod CORS=* 위험 — 즉시 수정 필요!"
    else
      _warn "prod CORS '$ACTUAL_CORS' — docs/DEPLOY.md 매트릭스와 대조"
    fi
    ;;
esac

# ─────────────────────────────────────────────────────────────
# 8. prod 추가 검증 (interactive)
# ─────────────────────────────────────────────────────────────
step "8/8: prod 전용 검증"
if [ "$ENV" = "prod" ]; then
  LAST_MSG=$(git log -1 --pretty=format:"%s")
  case "$LAST_MSG" in
    feat:*|fix:*|merge:*|refactor:*|docs:*|chore:*|test:*)
      _pass "커밋 메시지 컨벤션 충족: $LAST_MSG"
      ;;
    *)
      _warn "커밋 메시지 컨벤션 위반: '$LAST_MSG' (prod 배포 권장 안 함)"
      ;;
  esac

  # interactive 확인 (CI 환경에서는 건너뜀 — SKIP_INTERACTIVE=1)
  if [ "${SKIP_INTERACTIVE:-0}" = "1" ]; then
    _warn "SKIP_INTERACTIVE=1 — interactive 확인 건너뜀"
  else
    printf "\n%s⚠  prod 배포를 진행하시겠습니까? 'yes' 입력 시에만 진행 →%s " "$C_YELLOW" "$C_OFF"
    read -r ANSWER
    if [ "$ANSWER" != "yes" ]; then
      _fail "사용자가 prod 배포 확인하지 않음. 중단."
    else
      _pass "사용자 prod 배포 승인"
    fi
  fi
else
  info "  (prod 아님, 스킵)"
fi

# ─────────────────────────────────────────────────────────────
# 요약
# ─────────────────────────────────────────────────────────────
printf "\n%s═══ preflight 요약 [%s] ═══%s\n" "$C_BOLD" "$ENV" "$C_OFF"
if [ "$CHECK_FAILED" -gt 0 ]; then
  printf "%s✘ FAILED: %d%s    %s⚠ WARNS: %d%s\n" "$C_RED" "$CHECK_FAILED" "$C_OFF" "$C_YELLOW" "$CHECK_WARNS" "$C_OFF"
  exit 1
fi
printf "%s✔ 모든 검사 통과%s (경고 %d건)\n" "$C_GREEN" "$C_OFF" "$CHECK_WARNS"
exit 0
