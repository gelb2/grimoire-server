-- 크레딧·구독·채팅 과금 개편 I Phase — 디노미네이션 1,000pt + 포인트 출처 분리 회계 + 채팅 4구간 차감
--
-- 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8 (v6)
--       .claude/state/sprint-credit-overhaul-s-phase-draft.md §6 매트릭스 + §7 단계 3·4
--
-- 본 마이그레이션은 2개 영역으로 구성:
--   [A] 스키마 변경 (prisma migrate diff 추출) — CreditLedger/MembershipPlan 신설 + Author/ChatMessage 필드
--   [B] 데이터 마이그레이션 (§7 단계4) — credits×1000 환산 + CreditLedger/MembershipPlan 초기 row
--
-- ⚠️ 적용 게이트 (§7 단계6/9 — 사용자 명시 키워드 필수):
--   - dev: "크레딧개편 dev migration 진행"  → npx prisma migrate deploy
--   - prod: "크레딧개편 prod migration 진행" → 백업(pg_dump) 후 npx prisma migrate deploy
--   본 sprint(I Phase 코드 작성)는 마이그레이션 파일 작성만 — 어떤 DB에도 apply 금지.
--
-- ⚠️ 마이그레이션 정합성 검증 (단계6/9 직후 필수 — 1pt도 어긋나면 롤백):
--   SELECT SUM(points_charged) FROM authors;           -- = SUM(credits)*1000 (마이그레이션 전 스냅샷)
--   SELECT COUNT(*) FROM credit_ledgers;               -- = credits>0 작가 수
--   dev 측정값(2026-05-17): authors 12 / SUM(credits)=100 / credits>0 작가=10
--   → 마이그레이션 후 기대: SUM(points_charged)=100000 / credit_ledgers row=10

-- =====================================================================
-- [A] 스키마 변경
-- =====================================================================

-- AlterTable — Author 포인트 출처 4종 분리 회계 잔액 캐시 + 외상 (1-C 하이브리드)
ALTER TABLE "authors" ADD COLUMN     "deficit_points" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "points_charged" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "points_free" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "points_gift" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "points_subscription" INTEGER NOT NULL DEFAULT 0;

-- AlterTable — ChatMessage 토큰 실측 + 4구간 차감 박제 (§8-8 CRITICAL #3 — 전부 nullable)
ALTER TABLE "chat_messages" ADD COLUMN     "charge_tier" TEXT,
ADD COLUMN     "charged_points" INTEGER,
ADD COLUMN     "input_tokens" INTEGER,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "output_tokens" INTEGER;

-- AlterTable — AnalysisReport.creditsCharged default 디노미 정정 (4 크레딧 → 2,440 pt)
ALTER TABLE "analysis_reports" ALTER COLUMN "credits_charged" SET DEFAULT 2440;

-- CreateTable — 포인트 입출금 원장 (1-C 하이브리드의 원장 측, audit 정본)
CREATE TABLE "credit_ledgers" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "reason" TEXT NOT NULL,
    "related_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable — 멤버십 등급 + 월 포인트 풀 (4-C 구조, 현행 Subscription 팔로우와 별개 도메인)
CREATE TABLE "membership_plans" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "monthly_pool_points" INTEGER NOT NULL DEFAULT 0,
    "pool_balance" INTEGER NOT NULL DEFAULT 0,
    "pool_reset_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "polar_subscription_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_ledgers_author_id_created_at_idx" ON "credit_ledgers"("author_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_ledgers_author_id_source_idx" ON "credit_ledgers"("author_id", "source");

-- CreateIndex
CREATE INDEX "credit_ledgers_expires_at_idx" ON "credit_ledgers"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "membership_plans_polar_subscription_id_key" ON "membership_plans"("polar_subscription_id");

-- CreateIndex
CREATE INDEX "membership_plans_author_id_idx" ON "membership_plans"("author_id");

-- CreateIndex
CREATE INDEX "membership_plans_pool_reset_at_idx" ON "membership_plans"("pool_reset_at");

-- CreateIndex
CREATE INDEX "membership_plans_status_idx" ON "membership_plans"("status");

-- AddForeignKey — CreditLedger.authorId Restrict (회계 영구 보존, ADR-007 정합)
ALTER TABLE "credit_ledgers" ADD CONSTRAINT "credit_ledgers_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — MembershipPlan.authorId Restrict (구독 이력 영구 보존, ADR-007 정합)
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- [B] 데이터 마이그레이션 (§7 단계4)
-- =====================================================================

-- (a) 기존 크레딧 잔액 디노미네이션 환산 — credits × 1,000 → points_charged
--     §8-6 정본: 기존 잔액 출처 분류 = 전량 "충전(유료)"으로 분류.
--     (무료적립으로 분류하면 CAC 과대 계상 / 충전으로 보면 §0 정합 — 이미 과거에 마진 확보된 크레딧)
UPDATE "authors"
SET "points_charged" = "credits" * 1000
WHERE "credits" > 0;

-- (b) CreditLedger 초기 row — credits > 0 작가별 1건 (type='earn', source='charged')
--     디노미네이션 환산을 원장에도 박제 — 잔액 캐시(points_charged)와 원장 정합 시작점.
INSERT INTO "credit_ledgers" ("id", "author_id", "source", "type", "amount", "balance_after", "reason", "created_at")
SELECT
  gen_random_uuid()::text,
  "id",
  'charged',
  'earn',
  "credits" * 1000,
  "credits" * 1000,
  'denomination_migration_v6',
  CURRENT_TIMESTAMP
FROM "authors"
WHERE "credits" > 0;

-- (c) MembershipPlan 초기 row — 전 작가 1건. 기존 Author.plan → tier 매핑.
--     monthly_pool_points / pool_balance: free=0 / pro=93,000 / premium=191,500 (§8-3).
--     pool_reset_at: 다음달 1일 0시 (이후 cron + lazy 가 매월 리셋).
--     기존 plan 값이 free/pro/premium 외(예외)면 free 로 폴백.
INSERT INTO "membership_plans" ("id", "author_id", "tier", "monthly_pool_points", "pool_balance", "pool_reset_at", "started_at", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  "id",
  CASE WHEN "plan" IN ('free', 'pro', 'premium') THEN "plan" ELSE 'free' END,
  CASE "plan" WHEN 'pro' THEN 93000 WHEN 'premium' THEN 191500 ELSE 0 END,
  CASE "plan" WHEN 'pro' THEN 93000 WHEN 'premium' THEN 191500 ELSE 0 END,
  date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month',
  CURRENT_TIMESTAMP,
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "authors";

-- (c-2) 구독 작가(pro/premium)는 초기 풀을 CreditLedger 에도 박제 — source='subscription' + expires_at=다음 리셋일.
--       만료 row 는 잔액 집계에서 제외 → 이월 구조적 불가(§8-8 #2).
INSERT INTO "credit_ledgers" ("id", "author_id", "source", "type", "amount", "balance_after", "expires_at", "reason", "created_at")
SELECT
  gen_random_uuid()::text,
  a."id",
  'subscription',
  'earn',
  CASE a."plan" WHEN 'pro' THEN 93000 WHEN 'premium' THEN 191500 ELSE 0 END,
  (a."credits" * 1000) + CASE a."plan" WHEN 'pro' THEN 93000 WHEN 'premium' THEN 191500 ELSE 0 END,
  date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month',
  'subscription_pool_migration_v6',
  CURRENT_TIMESTAMP
FROM "authors" a
WHERE a."plan" IN ('pro', 'premium');

-- (c-3) 구독 작가 Author.points_subscription 캐시도 초기 풀로 동기 (원장과 캐시 정합).
UPDATE "authors"
SET "points_subscription" = CASE "plan" WHEN 'pro' THEN 93000 WHEN 'premium' THEN 191500 ELSE 0 END
WHERE "plan" IN ('pro', 'premium');

-- (d) AnalysisReport 기존 row 단위 정정 — 구 데이터의 credits_charged(정수 크레딧)를 pt 로 환산.
--     기존 운영값은 4(크레딧) → 디노미 후 2,440 pt. 정수 크레딧 범위(≤ 100)인 row 만 ×? 환산:
--     운영상 분석은 항상 4 크레딧 고정 → 4 인 row 를 2,440 으로 일괄 정정.
--     (3 인 과거 row 가 있으면 1,830 — 구 3 크레딧 환산. 그 외 값은 ×610 으로 비례 환산)
UPDATE "analysis_reports" SET "credits_charged" = 2440 WHERE "credits_charged" = 4;
UPDATE "analysis_reports" SET "credits_charged" = 1830 WHERE "credits_charged" = 3;
UPDATE "analysis_reports" SET "credits_charged" = "credits_charged" * 610
  WHERE "credits_charged" NOT IN (4, 3, 2440, 1830) AND "credits_charged" < 100;
