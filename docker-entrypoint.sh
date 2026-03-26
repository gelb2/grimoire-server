#!/bin/sh
set -e

# Prisma 마이그레이션
if [ "$SKIP_MIGRATION" = "true" ]; then
  echo "마이그레이션 스킵 (SKIP_MIGRATION=true)"
elif [ "$NODE_ENV" = "production" ] && [ "$RUN_MIGRATION" != "true" ]; then
  echo "프로덕션 환경에서는 RUN_MIGRATION=true 필요 — 마이그레이션 스킵"
else
  echo "Prisma 마이그레이션 실행..."
  npx prisma migrate deploy
  echo "마이그레이션 완료"
fi

# 서버 시작
exec node dist/src/main.js
