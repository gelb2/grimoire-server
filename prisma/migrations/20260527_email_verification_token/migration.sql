-- EMAIL-POLAR-READY Phase C (2026-05-27) — EmailVerificationToken 신 모델.
-- 사용자 라이브 액션 게이트 통과 전(`EMAIL_PROVIDER=null`)에도 토큰 발급/검증 흐름 박제.
-- 외부 발송만 NullEmailAdapter 시 0건 (logger.warn).
--
-- 정본:
--   .claude/state/sprint-email-polar-ready-plan-draft.md §7 + §13
--   .claude/shared-contracts.md §32 EmailVerificationTokenPolicy
--
-- 비가역성: 신 테이블 추가 (down migration = DROP TABLE)
-- rollback: prisma/migrations/20260527_email_verification_token/down.sql 참조 (별도)

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expire_at" TIMESTAMPTZ(3) NOT NULL,
    "redeemed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (token_hash unique — 평문 토큰 검증 시 O(1) 조회)
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex (authorId + expireAt — 작가별 유효 토큰 조회)
CREATE INDEX "email_verification_tokens_author_id_expire_at_idx" ON "email_verification_tokens"("author_id", "expire_at");

-- CreateIndex (purpose + expireAt — 만료 토큰 일괄 정리 cron 용)
CREATE INDEX "email_verification_tokens_purpose_expire_at_idx" ON "email_verification_tokens"("purpose", "expire_at");

-- AddForeignKey (Restrict — Author hard delete 시 차단, 토큰 영구 보존 감사용)
ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "authors"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
