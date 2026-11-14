#!/usr/bin/env bash
# preflight.sh — 배포 전 전수검사 (grimoire-server)
# 사용: ./scripts/preflight.sh <env>
#   <env>: dev | prod
# 정본: docs/DEPLOY.md §4 preflight 전수검사 항목
#
# 모든 검사 통과 → exit 0
# 하나라도 실패 → 검사 목록 출력 후 exit 1
#
# 2026-06-10 GCP 전환: Azure(az account/acr/containerapp) → GCP(gcloud auth/config/
#   Artifact Registry/Cloud Run/Cloud SQL) 검증. 모든 gcloud 측정은 --project 명시 강제
#   (로컬 gcloud 전역 default 가 pr-letter-addr/ne3 일 수 있음 → 무지정은 거짓 PASS/FAIL).

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./deploy-common.sh
source "${SCRIPT_DIR}/deploy-common.sh"

ENV="${1:-}"
validate_env "$ENV"
validate_cloud_config "$ENV"

# 체크 결과 추적 (bash 3.2 호환 — associative array 미사용)
CHECK_FAILED=0
CHECK_WARNS=0

# 편의 래퍼
_fail() { printf "%s[FAIL]%s %s\n" "$C_RED" "$C_OFF" "$*" >&2; CHECK_FAILED=$((CHECK_FAILED+1)); }
_pass() { printf "%s[PASS]%s %s\n" "$C_GREEN" "$C_OFF" "$*"; }
_warn() { printf "%s[WARN]%s %s\n" "$C_YELLOW" "$C_OFF" "$*" >&2; CHECK_WARNS=$((CHECK_WARNS+1)); }

printf "\n%s╔══ grimoire-server preflight [%s] ══╗%s\n" "$C_BOLD" "$ENV" "$C_OFF"
print_matrix "$ENV"

APP_NAME=$(env_to_app_name "$ENV")

# ─────────────────────────────────────────────────────────────
# 1/8. git 상태
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
# 2/8. gcloud CLI 상태 (auth + project)
# 모든 gcloud 측정은 --project 명시 강제 (전역 default 가 pr-letter-addr 일 수 있음).
# ─────────────────────────────────────────────────────────────
step "2/8: gcloud CLI 로그인 + 프로젝트 상태"
ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null || echo "")
if [ -z "$ACTIVE_ACCOUNT" ]; then
  _fail "gcloud 활성 계정 없음. 'gcloud auth login' 실행 필요."
elif [ "$ACTIVE_ACCOUNT" != "$EXPECTED_GCP_ACCOUNT" ]; then
  _warn "gcloud 활성 계정 '$ACTIVE_ACCOUNT' ≠ 기대 '$EXPECTED_GCP_ACCOUNT' (배포는 --project 명시로 진행)"
else
  _pass "gcloud 활성 계정: $ACTIVE_ACCOUNT"
fi

# 프로젝트 접근 가능 여부 (전역 default 와 무관하게 --project 명시로 직접 확인)
if gcloud projects describe "$GCP_PROJECT_ID" --format="value(projectId)" >/dev/null 2>&1; then
  _pass "프로젝트 접근 가능: $GCP_PROJECT_ID"
else
  _fail "프로젝트 '$GCP_PROJECT_ID' 접근 불가 (권한 또는 로그인 확인 필요)"
fi

# 전역 default 가 다른 프로젝트면 안내 (FAIL 아님 — 스크립트는 항상 --project 명시)
GLOBAL_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
if [ "$GLOBAL_PROJECT" != "$GCP_PROJECT_ID" ]; then
  _warn "gcloud 전역 default project='$GLOBAL_PROJECT' ≠ '$GCP_PROJECT_ID' (스크립트는 --project 명시로 안전. 'gcloud config set project' 불필요)"
fi

# ─────────────────────────────────────────────────────────────
# 3/8. Artifact Registry 접근 (repo 존재 + Docker 인증)
# ─────────────────────────────────────────────────────────────
step "3/8: Artifact Registry 접근"
if gcloud artifacts repositories describe "$ARTIFACT_REPO" \
    --location "$GCP_REGION" --project "$GCP_PROJECT_ID" \
    --format="value(name)" >/dev/null 2>&1; then
  _pass "Artifact Registry repo '$ARTIFACT_REPO' 존재 ($GCP_REGION)"
else
  _fail "Artifact Registry repo '$ARTIFACT_REPO' 없음 ($GCP_PROJECT_ID/$GCP_REGION). docs/DEPLOY.md §1 확인."
fi

# Docker credential helper 등록 여부 (config.json)
if grep -q "$ARTIFACT_REGISTRY_HOST" "$HOME/.docker/config.json" 2>/dev/null; then
  _pass "Docker credential helper 등록됨 ($ARTIFACT_REGISTRY_HOST)"
else
  _warn "Docker credential helper 미등록. 'gcloud auth configure-docker $ARTIFACT_REGISTRY_HOST' 권장 (배포 시 자동 시도)."
fi

# ─────────────────────────────────────────────────────────────
# 4/8. Cloud Run 서비스 존재 + 프로젝트/리전 일치
# ─────────────────────────────────────────────────────────────
step "4/8: Cloud Run 서비스 존재 확인"
SVC_URL=$(gcloud run services describe "$APP_NAME" \
  --region "$GCP_REGION" --project "$GCP_PROJECT_ID" \
  --format="value(status.url)" 2>/dev/null || echo "")
if [ -z "$SVC_URL" ]; then
  _fail "Cloud Run 서비스 '$APP_NAME' 이 '$GCP_PROJECT_ID/$GCP_REGION'에 없음"
else
  EXPECTED_RUN_URL=$(env_to_run_url "$ENV")
  if [ "$SVC_URL" != "$EXPECTED_RUN_URL" ]; then
    _warn "Cloud Run URL '$SVC_URL' ≠ 매트릭스 '$EXPECTED_RUN_URL' (도메인/리비전 차이 가능)"
  else
    _pass "Cloud Run 서비스 '$APP_NAME' (URL: $SVC_URL)"
  fi
fi

# ─────────────────────────────────────────────────────────────
# 5/8. Cloud SQL 인스턴스 존재
# ─────────────────────────────────────────────────────────────
step "5/8: Cloud SQL 인스턴스 존재 확인"
CLOUDSQL_INSTANCE=$(env_to_cloudsql_instance "$ENV")
# connection name 의 마지막 토큰이 인스턴스 ID (project:region:INSTANCE)
SQL_INSTANCE_ID="${CLOUDSQL_INSTANCE##*:}"
SQL_STATE=$(gcloud sql instances describe "$SQL_INSTANCE_ID" \
  --project "$GCP_PROJECT_ID" --format="value(state)" 2>/dev/null || echo "")
if [ -z "$SQL_STATE" ]; then
  _fail "Cloud SQL 인스턴스 '$SQL_INSTANCE_ID' 없음 ($GCP_PROJECT_ID)"
elif [ "$SQL_STATE" != "RUNNABLE" ]; then
  _warn "Cloud SQL 인스턴스 '$SQL_INSTANCE_ID' 상태=$SQL_STATE (RUNNABLE 아님)"
else
  _pass "Cloud SQL 인스턴스 '$SQL_INSTANCE_ID' RUNNABLE"
fi

# ─────────────────────────────────────────────────────────────
# 6/8. Docker daemon
# ─────────────────────────────────────────────────────────────
step "6/8: Docker daemon"
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
# 7/8. 필수 환경변수 + Secret 바인딩 존재 (Cloud Run) + CORS/APP_ENV 검증
# 값은 출력하지 않음 — 존재 여부 + 정책 정합만.
# ─────────────────────────────────────────────────────────────
step "7/8: Cloud Run 환경변수 / Secret 바인딩 / CORS / APP_ENV"
# Cloud Run revision 템플릿의 env 목록 (plain name + secretRef name 모두 포함)
ENV_KEYS=$(gcloud run services describe "$APP_NAME" \
  --region "$GCP_REGION" --project "$GCP_PROJECT_ID" \
  --format="value(spec.template.spec.containers[0].env[].name)" 2>/dev/null | tr ';' '\n' || echo "")

# 필수 키 (plain + secret 혼합) — docs/DEPLOY.md §4.6
REQUIRED_KEYS=("DATABASE_URL" "JWT_SECRET" "CORS_ORIGIN" "APP_ENV" "POLAR_ACCESS_TOKEN" "POLAR_WEBHOOK_SECRET" "ANTHROPIC_API_KEY" "OPENAI_API_KEY")
for key in "${REQUIRED_KEYS[@]}"; do
  if printf "%s\n" "$ENV_KEYS" | grep -qx "$key"; then
    _pass "$key 설정됨"
  else
    _fail "$key 누락. gcloud run services update --update-env-vars / --update-secrets 로 설정 필요."
  fi
done

# APP_ENV 값 검증 (dev → development, prod → production)
ACTUAL_APP_ENV=$(gcloud run services describe "$APP_NAME" \
  --region "$GCP_REGION" --project "$GCP_PROJECT_ID" \
  --format="value(spec.template.spec.containers[0].env)" 2>/dev/null \
  | tr ';' '\n' | grep -E "^APP_ENV=" | head -1 | cut -d= -f2- || echo "")
EXPECTED_APP_ENV="$ENV"
if [ "$ENV" = "dev" ]; then EXPECTED_APP_ENV="development"; fi
if [ "$ENV" = "prod" ]; then EXPECTED_APP_ENV="production"; fi
if [ -z "$ACTUAL_APP_ENV" ]; then
  _warn "APP_ENV 값 조회 불가 (Secret 바인딩이면 정상 — plain env 만 값 노출)"
elif [ "$ACTUAL_APP_ENV" != "$EXPECTED_APP_ENV" ]; then
  _fail "APP_ENV 불일치: 실제 '$ACTUAL_APP_ENV' ≠ 기대 '$EXPECTED_APP_ENV'"
else
  _pass "APP_ENV: $ACTUAL_APP_ENV"
fi

# CORS_ORIGIN 환경별 검증
ACTUAL_CORS=$(gcloud run services describe "$APP_NAME" \
  --region "$GCP_REGION" --project "$GCP_PROJECT_ID" \
  --format="value(spec.template.spec.containers[0].env)" 2>/dev/null \
  | tr ';' '\n' | grep -E "^CORS_ORIGIN=" | head -1 | cut -d= -f2- || echo "")
case "$ENV" in
  dev)
    if [ "$ACTUAL_CORS" = "*" ]; then
      _warn "dev CORS=* (의도됨). 그러나 prod는 엄격해야 함."
    else
      _pass "dev CORS: $ACTUAL_CORS"
    fi
    ;;
  prod)
    if [ -n "$ACTUAL_CORS" ] && [ "$ACTUAL_CORS" = "${CORS_ORIGIN_PROD:-}" ]; then
      _pass "prod CORS 정확"
    elif [ "$ACTUAL_CORS" = "*" ]; then
      _fail "prod CORS=* 위험 — 즉시 수정 필요!"
    else
      _warn "prod CORS '$ACTUAL_CORS' — docs/DEPLOY.md 매트릭스와 대조"
    fi
    ;;
esac

# ─────────────────────────────────────────────────────────────
# 8/8. prod 추가 검증 (interactive)
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
