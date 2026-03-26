#!/bin/sh
# Docker 컨테이너 시작 시 실행되는 엔트리포인트
# 마이그레이션 실행 후 서버 시작
set -e

# 마이그레이션 실행 제어
# - SKIP_MIGRATION=true: 마이그레이션 완전 스킵
# - NODE_ENV=production: 명시적 RUN_MIGRATION=true 없이는 스킵 (안전장치)
if [ "$SKIP_MIGRATION" = "true" ]; then
  echo "=== 마이그레이션 스킵 (SKIP_MIGRATION=true)"
elif [ "$NODE_ENV" = "production" ] && [ "$RUN_MIGRATION" != "true" ]; then
  echo "=== 운영 환경에서는 마이그레이션 자동 실행 안 함 (RUN_MIGRATION=true 로 명시적 요청 필요)"
else
  echo "=== Prisma 마이그레이션 실행 중..."
  if ! npx prisma migrate deploy; then
    echo "=== 마이그레이션 실패 — 컨테이너 종료"
    exit 1
  fi
  echo "=== 마이그레이션 완료"
fi

echo "=== 서버 시작..."
exec node dist/src/main.js
