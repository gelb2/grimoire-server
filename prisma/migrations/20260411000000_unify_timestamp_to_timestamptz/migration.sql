-- 모든 TIMESTAMP(3) 컬럼을 TIMESTAMPTZ(3)로 통일
-- 목적: inhouse(without tz) / production(with tz) 불일치 해소
-- 기존 데이터: UTC 기준이므로 값 변경 없음 (타입만 변경)

-- authors
ALTER TABLE "authors" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);
ALTER TABLE "authors" ALTER COLUMN "plan_expire_at" SET DATA TYPE TIMESTAMPTZ(3);

-- themes
ALTER TABLE "themes" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- works
ALTER TABLE "works" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- episodes
ALTER TABLE "episodes" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);
ALTER TABLE "episodes" ALTER COLUMN "shared_expire_at" SET DATA TYPE TIMESTAMPTZ(3);

-- credit_logs
ALTER TABLE "credit_logs" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- social_accounts
ALTER TABLE "social_accounts" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- signup_history
ALTER TABLE "signup_history" ALTER COLUMN "first_signup_at" SET DATA TYPE TIMESTAMPTZ(3);

-- bookmarks
ALTER TABLE "bookmarks" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- reading_progress
ALTER TABLE "reading_progress" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- likes
ALTER TABLE "likes" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- subscriptions
ALTER TABLE "subscriptions" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- comments
ALTER TABLE "comments" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- payments
ALTER TABLE "payments" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);
ALTER TABLE "payments" ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMPTZ(3);

-- chat_sessions
ALTER TABLE "chat_sessions" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);
ALTER TABLE "chat_sessions" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- chat_messages
ALTER TABLE "chat_messages" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);
