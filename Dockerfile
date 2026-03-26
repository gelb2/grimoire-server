# Grimoire Server — Dockerfile (멀티스테이지 빌드)

# 1단계: 빌드
# 노드 버전 — 재현 가능한 빌드 보장
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# 스키마 유효성 검증 후 클라이언트 생성 (더미 URL로 validate 통과)
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma validate
RUN npx prisma generate
RUN npm run build

# 2단계: 실행 (빌드 결과물만 포함 → 이미지 경량화)
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl tini
WORKDIR /app

# 환경 변수는 Docker 이미지에 포함하지 않음
# Azure: Container App 환경 변수로 주입
# 로컬: docker-compose.yml environment 섹션으로 주입

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

# tini를 PID 1로 사용하여 SIGTERM 적절히 전파
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./docker-entrypoint.sh"]
