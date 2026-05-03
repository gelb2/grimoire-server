-- Migration: add_refund_log (Sprint PAY-P1-1, 2026-05-03)
-- 신규 테이블 추가만 — 기존 테이블 변경 0건 → 무중단 OK
-- 정본: .claude/shared-contracts.md §13 RefundPaymentAtomically

-- CreateTable
CREATE TABLE "refund_logs" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "deficit_credits" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "refund_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refund_logs_payment_id_idx" ON "refund_logs"("payment_id");
