-- 사용자 제재 테이블
CREATE TABLE "user_sanctions" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "admin_id" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_sanctions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "user_sanctions_author_id_is_active_idx" ON "user_sanctions"("author_id", "is_active");
CREATE INDEX "user_sanctions_end_at_idx" ON "user_sanctions"("end_at");

-- 콘텐츠 신고 테이블
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reporter_id" TEXT,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");
CREATE INDEX "reports_target_type_target_id_idx" ON "reports"("target_type", "target_id");

-- 시스템 설정 테이블
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- 기본 설정값 삽입
INSERT INTO "system_settings" ("key", "value", "updated_at") VALUES
  ('maintenance_mode', 'false', NOW()),
  ('recaptcha_enabled', 'true', NOW()),
  ('rate_limit_login', '10', NOW()),
  ('rate_limit_register', '5', NOW());
