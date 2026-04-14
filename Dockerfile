# Grimoire Server — Dockerfile (멀티스테이지 빌드)

# 1단계: 빌드
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

# 2단계: production 의존성만 설치
FROM node:20-alpine AS prod-deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
# Prisma 클라이언트는 prod-deps에서도 필요
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# 3단계: 실행 (빌드 결과물 + prod 의존성만)
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl tini

# non-root 유저 (컨테이너 보안)
RUN addgroup -g 1001 -S nodejs && adduser -S grimoire -u 1001
WORKDIR /app

COPY --from=builder --chown=grimoire:nodejs /app/dist ./dist
COPY --from=prod-deps --chown=grimoire:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=grimoire:nodejs /app/package*.json ./
COPY --from=builder --chown=grimoire:nodejs /app/prisma ./prisma

COPY --chown=grimoire:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER grimoire
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./docker-entrypoint.sh"]
