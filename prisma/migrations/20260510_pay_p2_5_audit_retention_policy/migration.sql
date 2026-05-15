-- PAY-P2-5 audit retention 정책 (사용자 결정 옵션 D, 5/10)
-- 영구 보존 + 90일 후 PII 마스킹 (DELETE 0건 강제)
-- 4 모델: AdminAuditLog / WebhookEvent / WebhookRetryQueue / AccessLog

-- AdminAuditLog
ALTER TABLE "admin_audit_logs"
  ADD COLUMN "masked_at" TIMESTAMPTZ(3),
  ADD COLUMN "retention_tier" TEXT NOT NULL DEFAULT 'active';

CREATE INDEX "admin_audit_logs_retention_tier_created_at_idx"
  ON "admin_audit_logs"("retention_tier", "created_at");

-- WebhookEvent
ALTER TABLE "webhook_events"
  ADD COLUMN "masked_at" TIMESTAMPTZ(3),
  ADD COLUMN "retention_tier" TEXT NOT NULL DEFAULT 'active';

CREATE INDEX "webhook_events_retention_tier_processed_at_idx"
  ON "webhook_events"("retention_tier", "processed_at");

-- WebhookRetryQueue
ALTER TABLE "webhook_retry_queues"
  ADD COLUMN "masked_at" TIMESTAMPTZ(3),
  ADD COLUMN "retention_tier" TEXT NOT NULL DEFAULT 'active';

CREATE INDEX "webhook_retry_queues_retention_tier_created_at_idx"
  ON "webhook_retry_queues"("retention_tier", "created_at");

-- AccessLog
ALTER TABLE "access_logs"
  ADD COLUMN "masked_at" TIMESTAMPTZ(3),
  ADD COLUMN "retention_tier" TEXT NOT NULL DEFAULT 'active';

CREATE INDEX "access_logs_retention_tier_created_at_idx"
  ON "access_logs"("retention_tier", "created_at");
