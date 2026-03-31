#!/bin/bash
# dev DB → 로컬 Docker DB 동기화
# 사용법: ./scripts/db-sync-local.sh
# 전제: Docker DB가 실행 중이어야 함 (docker-compose up db)

set -e

echo "╔══════════════════════════════════════╗"
echo "║   dev DB → localhost 동기화"
echo "╚══════════════════════════════════════╝"

# 1. 현재 IP 확인
MY_IP=$(curl -s ifconfig.me)
echo "[1/4] 현재 IP: $MY_IP"

# 2. dev DB 방화벽 임시 추가
echo "[2/4] dev DB 방화벽 규칙 추가..."
az postgres flexible-server firewall-rule create \
  --resource-group zenith-rg \
  --name grimoire-db-dev \
  --rule-name temp-local-sync \
  --start-ip-address "$MY_IP" \
  --end-ip-address "$MY_IP" \
  --output none 2>/dev/null

# 방화벽 제거를 보장하는 trap
cleanup() {
  echo "[4/4] 방화벽 규칙 제거..."
  az postgres flexible-server firewall-rule delete \
    --resource-group zenith-rg \
    --name grimoire-db-dev \
    --rule-name temp-local-sync \
    --yes --output none 2>/dev/null || true
  echo "정리 완료"
}
trap cleanup EXIT

# 3. 동기화 실행
echo "[3/4] dev → local 동기화 시작..."
npx tsx scripts/db-sync.ts dev local

echo "╔══════════════════════════════════════╗"
echo "║   완료!"
echo "╚══════════════════════════════════════╝"
