-- Sprint PAY-P0-1 (2026-05-03): 웹훅 이벤트 멱등성 박제 테이블 신설
-- - eventId UNIQUE: PG webhook 재전송 시 race condition 차단 (P2002 → safe skip)
-- - 신규 테이블 추가만 (기존 테이블 변경 0건) — 무중단 OK
-- 정본: `.claude/shared-contracts.md` §11 WebhookEventIdempotency

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'polar',
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "error_message" TEXT,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_event_id_key" ON "webhook_events"("event_id");

-- CreateIndex
CREATE INDEX "webhook_events_event_type_processed_at_idx" ON "webhook_events"("event_type", "processed_at");
