-- CreateTable
CREATE TABLE "webhook_retry_queues" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_retry_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_retry_queues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_retry_queues_event_id_key" ON "webhook_retry_queues"("event_id");

-- CreateIndex
CREATE INDEX "webhook_retry_queues_next_retry_at_idx" ON "webhook_retry_queues"("next_retry_at");
