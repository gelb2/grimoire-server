#!/usr/bin/env bash
# db-sync-remote.sh — 원격 DB 간 동기화 래퍼 (Makefile 진입점)
#
# 정본: INFRASTRUCTURE.md §10 DB 동기화 정책
# 비상용 수단: GitHub Actions `db-sync-nightly.yml`이 다운되거나 빌링 문제 시
#   로컬에서 동일한 로직으로 수동 실행 가능. 스크립트가 정본, CI는 래퍼로 관리.
#
# 2026-05-27 GCP 영역: Azure 의존 영역 (azure/login + az postgres firewall-rule) 영역 일괄 제거.
#   Cloud SQL Auth Proxy 영역 spawn 영역 대체 — 양측 DB 영역 localhost:port 영역 binding 영역.
#
# 사용:
#   ./scripts/db-sync-remote.sh prod dev --mask-pii       # PII 마스킹
#
# 환경변수:
#   DB_PASSWORD_PROD       prod Cloud SQL 비밀번호 (필수)
#   DB_PASSWORD_DEV        dev Cloud SQL 비밀번호 (필수)
#   SKIP_INTERACTIVE=1     prod 확인 프롬프트 스킵

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")"  # grimoire-server/ 루트

# deploy-common.sh에서 info/ok/warn/fail/step 로드 (RESOURCE_GROUP 등 Azure 상수는 무시)
source "${SCRIPT_DIR}/deploy-common.sh"

SOURCE="${1:-}"
TARGET="${2:-}"
MASK_FLAG="${3:-}"

# ─────────────────────────────────────────────────────────────
# 0. GCP 영역 상수 (Cloud SQL 영역 정합)
# ─────────────────────────────────────────────────────────────
readonly GCP_PROJECT_ID="grimoire-491708"
readonly GCP_REGION="asia-northeast1"
readonly CLOUD_SQL_DEV="grimoire-491708:asia-northeast1:grimoire-db-dev"
readonly CLOUD_SQL_PROD="grimoire-491708:asia-northeast1:grimoire-db-prod"
readonly PORT_SOURCE=5432
readonly PORT_TARGET=5433
readonly PROXY_VERSION="v2.13.0"

# ─────────────────────────────────────────────────────────────
# 1. 입력 검증
# ─────────────────────────────────────────────────────────────
if [ -z "$SOURCE" ] || [ -z "$TARGET" ]; then
  fail "사용: $0 SOURCE TARGET [--mask-pii]"
fi

case "$SOURCE" in prod|dev) ;; *) fail "SOURCE는 prod|dev 중 하나 (got '$SOURCE')" ;; esac
case "$TARGET" in dev)      ;; *) fail "TARGET은 dev만 허용 (got '$TARGET'). local 경로는 scripts/db-sync-local.sh 사용" ;; esac

if [ "$SOURCE" = "$TARGET" ]; then
  fail "SOURCE와 TARGET이 같습니다"
fi

# 방향 검증 — prod=3, dev=1. 하위→상위 금지.
rank_of() {
  case "$1" in prod) echo 3 ;; dev) echo 1 ;; *) echo 0 ;; esac
}
if [ "$(rank_of "$SOURCE")" -le "$(rank_of "$TARGET")" ]; then
  fail "하위 → 상위 동기화 금지: $SOURCE → $TARGET (허용: prod→dev)"
fi

if [ -n "$MASK_FLAG" ] && [ "$MASK_FLAG" != "--mask-pii" ]; then
  fail "세 번째 인자는 --mask-pii만 허용 (got '$MASK_FLAG')"
fi

# ─────────────────────────────────────────────────────────────
# 2. preflight — 자격증명 + gcloud 영역 + Auth Proxy 영역 + Prisma 영역
# ─────────────────────────────────────────────────────────────
step "preflight"

# 환경별 비밀번호 영역 분리 강제
DB_PW_SOURCE=""
DB_PW_TARGET=""
case "$SOURCE" in
  prod) DB_PW_SOURCE="${DB_PASSWORD_PROD:-}" ;;
  dev)  DB_PW_SOURCE="${DB_PASSWORD_DEV:-}" ;;
esac
case "$TARGET" in
  dev)  DB_PW_TARGET="${DB_PASSWORD_DEV:-}" ;;
esac

if [ -z "$DB_PW_SOURCE" ]; then
  fail "DB_PASSWORD_${SOURCE^^} 환경변수 필수. export DB_PASSWORD_${SOURCE^^}=... 후 재실행"
fi
if [ -z "$DB_PW_TARGET" ]; then
  fail "DB_PASSWORD_${TARGET^^} 환경변수 필수. export DB_PASSWORD_${TARGET^^}=... 후 재실행"
fi

# gcloud 로그인 영역 (project + account)
current_account=$(gcloud config get-value account 2>/dev/null || echo "")
if [ -z "$current_account" ]; then
  fail "gcloud 로그인 필요: gcloud auth login"
fi
current_project=$(gcloud config get-value project 2>/dev/null || echo "")
if [ "$current_project" != "$GCP_PROJECT_ID" ]; then
  fail "gcloud project 영역 불일치 (현재=$current_project, 요구=$GCP_PROJECT_ID). gcloud config set project $GCP_PROJECT_ID"
fi
info "gcloud 로그인: $current_account (project=$current_project)"

# Cloud SQL Auth Proxy 영역 binary 영역 (없으면 다운로드)
PROXY_BIN="/tmp/cloud-sql-proxy-${PROXY_VERSION}"
if [ ! -x "$PROXY_BIN" ]; then
  info "Cloud SQL Auth Proxy 영역 다운로드 (${PROXY_VERSION})"
  # OS 영역 자동 감지 — darwin 영역 + linux 영역
  UNAME=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)
  case "$ARCH" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64) ARCH="amd64" ;;
    *) fail "지원 불가 아키텍처: $ARCH" ;;
  esac
  curl -sSL -o "$PROXY_BIN" \
    "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/${PROXY_VERSION}/cloud-sql-proxy.${UNAME}.${ARCH}" \
    || fail "Cloud SQL Auth Proxy 영역 다운로드 실패"
  chmod +x "$PROXY_BIN"
fi
info "Cloud SQL Auth Proxy: $PROXY_BIN"

# Prisma Client 최신 상태
if [ ! -d "node_modules/.prisma/client" ]; then
  info "Prisma Client 미생성 — generate 실행"
  npx prisma generate
fi
ok "preflight 통과"

# ─────────────────────────────────────────────────────────────
# 3. prod 관련 작업이면 interactive 확인 (SKIP_INTERACTIVE=1 시 스킵)
# ─────────────────────────────────────────────────────────────
if { [ "$SOURCE" = "prod" ] || [ "$TARGET" = "prod" ]; } && [ -z "${SKIP_INTERACTIVE:-}" ]; then
  warn "PROD가 관여된 동기화입니다: $SOURCE → $TARGET"
  warn "타겟 DB의 기존 데이터는 전부 삭제됩니다."
  read -r -p "'yes' 입력으로 확인: " confirm
  if [ "$confirm" != "yes" ]; then
    fail "확인 취소됨. 중단."
  fi
fi

# ─────────────────────────────────────────────────────────────
# 4. Cloud SQL Auth Proxy 영역 spawn + trap 영역 보장 정리
# ─────────────────────────────────────────────────────────────
step "Cloud SQL Auth Proxy 영역 spawn (source + target)"

case "$SOURCE" in
  prod) SRC_CONN="$CLOUD_SQL_PROD" ;;
  dev)  SRC_CONN="$CLOUD_SQL_DEV" ;;
esac
case "$TARGET" in
  dev)  TGT_CONN="$CLOUD_SQL_DEV" ;;
esac

PROXY_LOG_DIR="/tmp/db-sync-proxy-$$"
mkdir -p "$PROXY_LOG_DIR"
PROXY_PID_SOURCE=""
PROXY_PID_TARGET=""

cleanup_proxy() {
  step "Auth Proxy 영역 정리 (cleanup)"
  if [ -n "$PROXY_PID_SOURCE" ]; then kill "$PROXY_PID_SOURCE" 2>/dev/null || true; fi
  if [ -n "$PROXY_PID_TARGET" ]; then kill "$PROXY_PID_TARGET" 2>/dev/null || true; fi
  rm -rf "$PROXY_LOG_DIR" 2>/dev/null || true
  ok "Auth Proxy 영역 정리 완료"
}
trap cleanup_proxy EXIT

info "  source($SOURCE)=$SRC_CONN → 127.0.0.1:$PORT_SOURCE"
"$PROXY_BIN" --port "$PORT_SOURCE" "$SRC_CONN" > "$PROXY_LOG_DIR/source.log" 2>&1 &
PROXY_PID_SOURCE=$!

info "  target($TARGET)=$TGT_CONN → 127.0.0.1:$PORT_TARGET"
"$PROXY_BIN" --port "$PORT_TARGET" "$TGT_CONN" > "$PROXY_LOG_DIR/target.log" 2>&1 &
PROXY_PID_TARGET=$!

# Proxy 영역 준비 영역 대기 (최대 30s)
for i in $(seq 1 30); do
  if nc -z 127.0.0.1 "$PORT_SOURCE" 2>/dev/null && nc -z 127.0.0.1 "$PORT_TARGET" 2>/dev/null; then
    ok "Auth Proxy 영역 준비 완료 (${i}s)"
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then
    cat "$PROXY_LOG_DIR/source.log" "$PROXY_LOG_DIR/target.log" >&2
    fail "Auth Proxy 영역 준비 영역 시간 영역 초과 (30s)"
  fi
done

# ─────────────────────────────────────────────────────────────
# 5. db-sync.ts 실행
# ─────────────────────────────────────────────────────────────
step "DB 동기화 실행: $SOURCE → $TARGET ${MASK_FLAG}"

export DB_PASSWORD_SOURCE="$DB_PW_SOURCE"
export DB_PASSWORD_TARGET="$DB_PW_TARGET"
export DB_HOST_SOURCE="127.0.0.1"
export DB_HOST_TARGET="127.0.0.1"
export DB_PORT_SOURCE="$PORT_SOURCE"
export DB_PORT_TARGET="$PORT_TARGET"
export DB_SSL_MODE="disable"

if [ -n "$MASK_FLAG" ]; then
  npx tsx scripts/db-sync.ts "$SOURCE" "$TARGET" "$MASK_FLAG"
else
  npx tsx scripts/db-sync.ts "$SOURCE" "$TARGET"
fi

ok "동기화 성공: $SOURCE → $TARGET"
info "  Auth Proxy 영역 정리 영역 — EXIT trap 영역 자동 수행"
