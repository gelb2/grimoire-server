-- RenameColumn: payapp_trade_no → external_transaction_id (데이터 보존)
ALTER TABLE "payments" RENAME COLUMN "payapp_trade_no" TO "external_transaction_id";

-- 기존 unique index도 자동으로 따라가지만, 이름을 명시적으로 변경
ALTER INDEX IF EXISTS "payments_payapp_trade_no_key" RENAME TO "payments_external_transaction_id_key";
