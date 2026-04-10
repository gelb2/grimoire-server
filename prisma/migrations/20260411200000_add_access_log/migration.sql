-- 보안 접근 로그 테이블 (회원가입, 로그인 성공/실패, 비밀번호 변경)
CREATE TABLE "access_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "author_id" TEXT,
    "email" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "access_logs_action_created_at_idx" ON "access_logs"("action", "created_at");
CREATE INDEX "access_logs_ip_idx" ON "access_logs"("ip");
CREATE INDEX "access_logs_author_id_idx" ON "access_logs"("author_id");
