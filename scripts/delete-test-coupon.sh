#!/bin/bash
# 테스트 쿠폰 삭제 스크립트 — 운영 오픈 직전 1회 실행
# 쿠폰: GRIMOIREDEV3545F21975 (100% off, QA 전용)
# Polar Discount ID: dd7b24da-420a-4089-9df2-f01209677bfa

set -e

DISCOUNT_ID="dd7b24da-420a-4089-9df2-f01209677bfa"

# .env에서 POLAR_ACCESS_TOKEN 읽기
if [ -f "$(dirname "$0")/../.env" ]; then
  POLAR_ACCESS_TOKEN=$(grep POLAR_ACCESS_TOKEN "$(dirname "$0")/../.env" | head -1 | cut -d= -f2)
fi

if [ -z "$POLAR_ACCESS_TOKEN" ]; then
  echo "POLAR_ACCESS_TOKEN이 설정되지 않았습니다."
  echo "export POLAR_ACCESS_TOKEN=polar_oat_... 후 재실행하세요."
  exit 1
fi

echo "=== 테스트 쿠폰 삭제 ==="
echo "Discount ID: $DISCOUNT_ID"
echo "Code: GRIMOIREDEV3545F21975"
echo ""

# 삭제 전 확인
read -p "정말 삭제하시겠습니까? (y/N) " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "취소됨."
  exit 0
fi

# Polar API v1 — DELETE /v1/discounts/{id}
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X DELETE \
  "https://api.polar.sh/v1/discounts/$DISCOUNT_ID" \
  -H "Authorization: Bearer $POLAR_ACCESS_TOKEN")

if [ "$HTTP_STATUS" = "204" ] || [ "$HTTP_STATUS" = "200" ]; then
  echo "삭제 완료 (HTTP $HTTP_STATUS)"
elif [ "$HTTP_STATUS" = "404" ]; then
  echo "이미 삭제됨 (HTTP 404)"
else
  echo "삭제 실패 (HTTP $HTTP_STATUS)"
  # 상세 응답 확인
  curl -s -X DELETE \
    "https://api.polar.sh/v1/discounts/$DISCOUNT_ID" \
    -H "Authorization: Bearer $POLAR_ACCESS_TOKEN"
  exit 1
fi
