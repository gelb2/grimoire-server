-- CreateTable: ReconciliationCheckpoint (Sprint PAY-P0-2, 2026-05-03)
-- 단일 row 보장 — id='singleton' 고정. cron이 항상 같은 row를 upsert.
-- 책 Ch 16 "shared state via DB single-row checkpoint" 패턴.
CREATE TABLE "reconciliation_checkpoints" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "last_run_at" TIMESTAMPTZ(3) NOT NULL,
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "boost_count" INTEGER NOT NULL DEFAULT 0,
    "mismatch_count" INTEGER NOT NULL DEFAULT 0,
    "expire_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_checkpoints_pkey" PRIMARY KEY ("id")
);

-- Singleton seed: 첫 cron 실행 시 사용할 lastRunAt = NOW() - 24h
-- 이미 row가 있으면 INSERT skip (재실행 안전).
INSERT INTO "reconciliation_checkpoints" ("id", "last_run_at")
VALUES ('singleton', CURRENT_TIMESTAMP - INTERVAL '24 hours')
ON CONFLICT ("id") DO NOTHING;
