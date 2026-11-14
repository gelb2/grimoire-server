#!/bin/bash
# dev DB → 로컬 Docker DB 동기화
# 사용법: ./scripts/db-sync-local.sh
# 전제: Docker DB가 실행 중이어야 함 (docker-compose up db)
#
# 2026-05-27 GCP 영역: Azure 의존 영역 (az postgres firewall-rule) 영역 일괄 제거.
#   Cloud SQL Auth Proxy 영역 spawn 영역 대체 — dev DB 영역 127.0.0.1:5432 영역 binding.
#
# 환경변수:
#   DB_PASSWORD_DEV         dev Cloud SQL 비밀번호 (필수)
#   LOCAL_DATABASE_URL      대상 로컬 DB URL (필수, 루프백 비5432 포트)

set -e

: "${LOCAL_DATABASE_URL:?LOCAL_DATABASE_URL 필수}"

readonly GCP_PROJECT_ID="${GCP_PROJECT_ID:?GCP_PROJECT_ID 필수}"
readonly CLOUD_SQL_DEV="${CLOUD_SQL_DEV:?CLOUD_SQL_DEV 필수}"
readonly PROXY_VERSION="v2.13.0"
readonly DEV_PROXY_PORT=5433  # 로컬 docker 영역 5432 영역 충돌 회피
readonly LOCAL_PORT=5432

echo "╔══════════════════════════════════════╗"
echo "║   dev DB → localhost 동기화"
echo "╚══════════════════════════════════════╝"

# 1. 환경변수 검증
if [ -z "${DB_PASSWORD_DEV:-}" ]; then
  echo "❌ DB_PASSWORD_DEV 환경변수 필수" >&2
  exit 1
fi

current_project=$(gcloud config get-value project 2>/dev/null || echo "")
if [ "$current_project" != "$GCP_PROJECT_ID" ]; then
  echo "❌ gcloud project 불일치 (현재=$current_project, 요구=$GCP_PROJECT_ID)" >&2
  echo "   gcloud config set project $GCP_PROJECT_ID" >&2
  exit 1
fi
echo "[1/4] gcloud project: $current_project"

# 2. Cloud SQL Auth Proxy 영역 binary
PROXY_BIN="/tmp/cloud-sql-proxy-${PROXY_VERSION}"
if [ ! -x "$PROXY_BIN" ]; then
  echo "[2/4] Cloud SQL Auth Proxy 다운로드 (${PROXY_VERSION})"
  UNAME=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)
  case "$ARCH" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64) ARCH="amd64" ;;
    *) echo "❌ 지원 불가 아키텍처: $ARCH" >&2; exit 1 ;;
  esac
  curl -sSL -o "$PROXY_BIN" \
    "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/${PROXY_VERSION}/cloud-sql-proxy.${UNAME}.${ARCH}"
  chmod +x "$PROXY_BIN"
else
  echo "[2/4] Cloud SQL Auth Proxy 캐시 영역 사용: $PROXY_BIN"
fi

# 3. Auth Proxy spawn (dev → 127.0.0.1:5433)
PROXY_LOG="/tmp/db-sync-local-proxy-$$.log"
PROXY_PID=""
cleanup() {
  if [ -n "$PROXY_PID" ]; then kill "$PROXY_PID" 2>/dev/null || true; fi
  rm -f "$PROXY_LOG" 2>/dev/null || true
  echo "정리 완료"
}
trap cleanup EXIT

echo "[3/4] dev DB Auth Proxy spawn → 127.0.0.1:$DEV_PROXY_PORT"
"$PROXY_BIN" --port "$DEV_PROXY_PORT" "$CLOUD_SQL_DEV" > "$PROXY_LOG" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 30); do
  if nc -z 127.0.0.1 "$DEV_PROXY_PORT" 2>/dev/null; then
    echo "    Proxy 준비 영역 완료 (${i}s)"
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then
    cat "$PROXY_LOG" >&2
    echo "❌ Proxy 영역 준비 영역 초과 (30s)" >&2
    exit 1
  fi
done

# 4. 동기화 실행 (source=dev via Auth Proxy, target=local via Docker)
echo "[4/4] dev → local 동기화 시작..."
export DB_PASSWORD_SOURCE="$DB_PASSWORD_DEV"
export DB_PASSWORD_TARGET=""  # local 영역 LOCAL_DB_PASSWORD 영역 fallback 영역 정합
export DB_HOST_SOURCE="127.0.0.1"
export DB_PORT_SOURCE="$DEV_PROXY_PORT"
export DB_SSL_MODE="disable"
# Legacy 영역 fallback 영역 (target=local 영역 영역 LOCAL_DB_PASSWORD 영역 사용 영역)
export DB_PASSWORD="${DB_PASSWORD_DEV}"  # local 영역 fallback 영역

npx tsx scripts/db-sync.ts dev local

echo "╔══════════════════════════════════════╗"
echo "║   완료!"
echo "╚══════════════════════════════════════╝"
