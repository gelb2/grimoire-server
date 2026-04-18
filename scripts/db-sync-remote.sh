#!/usr/bin/env bash
# db-sync-remote.sh — 원격 DB 간 동기화 래퍼 (Makefile 진입점)
#
# 정본: INFRASTRUCTURE.md §10 DB 동기화 정책
# 비상용 수단: GitHub Actions `db-sync-nightly.yml`이 다운되거나 빌링 문제 시
#   로컬에서 동일한 로직으로 수동 실행 가능. 스크립트가 정본, CI는 래퍼로 관리.
#
# 사용:
#   ./scripts/db-sync-remote.sh prod inhouse              # PII 유지
#   ./scripts/db-sync-remote.sh prod dev --mask-pii       # PII 마스킹
#   ./scripts/db-sync-remote.sh inhouse dev --mask-pii    # prod 우회 경로
#
# 환경변수:
#   DB_PASSWORD           Azure DB 비밀번호 (필수)
#   SKIP_INTERACTIVE=1    prod 확인 프롬프트 스킵 (CI용)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")"  # grimoire-server/ 루트

# deploy-common.sh에서 info/ok/warn/fail/step + 상수 로드
source "${SCRIPT_DIR}/deploy-common.sh"

SOURCE="${1:-}"
TARGET="${2:-}"
MASK_FLAG="${3:-}"

# ─────────────────────────────────────────────────────────────
# 1. 입력 검증
# ─────────────────────────────────────────────────────────────
if [ -z "$SOURCE" ] || [ -z "$TARGET" ]; then
  fail "사용: $0 SOURCE TARGET [--mask-pii]"
fi

case "$SOURCE" in prod|inhouse|dev) ;; *) fail "SOURCE는 prod|inhouse|dev 중 하나 (got '$SOURCE')" ;; esac
case "$TARGET" in inhouse|dev)      ;; *) fail "TARGET은 inhouse|dev 중 하나 (got '$TARGET'). local 경로는 scripts/db-sync-local.sh 사용" ;; esac

if [ "$SOURCE" = "$TARGET" ]; then
  fail "SOURCE와 TARGET이 같습니다"
fi

# 방향 검증 — prod=3, inhouse=2, dev=1. 하위→상위 금지.
rank_of() {
  case "$1" in prod) echo 3 ;; inhouse) echo 2 ;; dev) echo 1 ;; *) echo 0 ;; esac
}
if [ "$(rank_of "$SOURCE")" -le "$(rank_of "$TARGET")" ]; then
  fail "하위 → 상위 동기화 금지: $SOURCE → $TARGET (허용: prod→inhouse, prod→dev, inhouse→dev)"
fi

# MASK_FLAG 처리
if [ -n "$MASK_FLAG" ] && [ "$MASK_FLAG" != "--mask-pii" ]; then
  fail "세 번째 인자는 --mask-pii만 허용 (got '$MASK_FLAG')"
fi

# ─────────────────────────────────────────────────────────────
# 2. preflight — 인증/자격증명/스키마 동기화
# ─────────────────────────────────────────────────────────────
step "preflight"

if [ -z "${DB_PASSWORD:-}" ]; then
  fail "DB_PASSWORD 환경변수 필수. export DB_PASSWORD=... 후 재실행"
fi

# Azure CLI 로그인 상태
current_user=$(az account show --query user.name -o tsv 2>/dev/null || echo "")
if [ -z "$current_user" ]; then
  fail "Azure CLI 로그인 필요: az login"
fi
info "Azure 로그인: $current_user"

# Prisma Client 최신 상태 (schema 변경 반영)
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
# 4. 방화벽 규칙 임시 추가 + trap으로 보장 제거
# ─────────────────────────────────────────────────────────────
step "방화벽 규칙 추가 (SOURCE + TARGET)"

MY_IP=$(curl -s --max-time 10 ifconfig.me || echo "")
if [ -z "$MY_IP" ]; then fail "러너 IP 확인 실패"; fi
info "러너 IP: $MY_IP"

FW_RULE_NAME="manual-db-sync-$(date +%s)"
DB_LIST=("grimoire-db-${SOURCE}" "grimoire-db-${TARGET}")

cleanup_firewall() {
  step "방화벽 규칙 제거 (cleanup)"
  for DB in "${DB_LIST[@]}"; do
    az postgres flexible-server firewall-rule delete \
      --resource-group "$RESOURCE_GROUP" \
      --name "$DB" \
      --rule-name "$FW_RULE_NAME" \
      --yes --output none 2>/dev/null || warn "  $DB: 규칙 제거 실패 (이미 없거나 네트워크 이슈)"
  done
  ok "방화벽 정리 완료"
}
trap cleanup_firewall EXIT

for DB in "${DB_LIST[@]}"; do
  info "  $DB에 $MY_IP 추가..."
  az postgres flexible-server firewall-rule create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$DB" \
    --rule-name "$FW_RULE_NAME" \
    --start-ip-address "$MY_IP" \
    --end-ip-address "$MY_IP" \
    --output none \
    || fail "$DB 방화벽 규칙 추가 실패"
done
ok "방화벽 규칙 추가 완료"

# ─────────────────────────────────────────────────────────────
# 5. db-sync.ts 실행
# ─────────────────────────────────────────────────────────────
step "DB 동기화 실행: $SOURCE → $TARGET ${MASK_FLAG}"

if [ -n "$MASK_FLAG" ]; then
  npx tsx scripts/db-sync.ts "$SOURCE" "$TARGET" "$MASK_FLAG"
else
  npx tsx scripts/db-sync.ts "$SOURCE" "$TARGET"
fi

ok "동기화 성공: $SOURCE → $TARGET"
info "  방화벽 정리는 EXIT trap으로 자동 수행됩니다"
