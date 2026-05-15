-- Sprint PAY-P3-E §3-1 + §3-2 — FK Cascade 정책 (모순-F 차단)
-- 단계 1 (33 FK 측정 시나리오 B 박제) + 단계 2 (옵션 C archive 박제 + 시나리오 A 회복) 종료 후 진입
-- 정합 박제: dev DB 33/33 시나리오 A (orphan=0), archive 3 row 영구 보존, revision 158 Healthy
-- 4 전략 분포: Cascade 16건 + Restrict 8건 + SetNull 9건

-- ──────────────────────────────────────────────────────────────────────
-- (a) Optional 변경 영역 (스키마 영역 — FeaturedWork.adminId / UserSanction.adminId Required → Optional)
-- 현재 dev DB 매트릭스 정합 박제 (단계 1 raw §3-3 dev 박제 영역, orphan=0 정합)
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE "featured_works" ALTER COLUMN "admin_id" DROP NOT NULL;
ALTER TABLE "user_sanctions" ALTER COLUMN "admin_id" DROP NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- (b) 기존 6 박제 영역 onDelete directive 영역 (DROP + ADD CONSTRAINT)
-- themes (SetNull) / works (Restrict + theme SetNull) / episodes (Cascade) / social_accounts (Cascade) / comments.parent (SetNull) / chat_messages (이미 Cascade 박제, 변경 0)
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE "themes" DROP CONSTRAINT "themes_author_id_fkey";
ALTER TABLE "themes" ADD CONSTRAINT "themes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "works" DROP CONSTRAINT "works_author_id_fkey";
ALTER TABLE "works" ADD CONSTRAINT "works_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "works" DROP CONSTRAINT "works_theme_id_fkey";
ALTER TABLE "works" ADD CONSTRAINT "works_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "episodes" DROP CONSTRAINT "episodes_work_id_fkey";
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_accounts" DROP CONSTRAINT "social_accounts_author_id_fkey";
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "comments" DROP CONSTRAINT "comments_parent_id_fkey";
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- chat_messages_session_id_fkey: 이미 ON DELETE CASCADE 박제 (변경 0) — 정합 정합 영역

-- ──────────────────────────────────────────────────────────────────────
-- (c) 25 raw FK 영역 ADD CONSTRAINT 영역 (Restrict 8 + Cascade 11 + SetNull 6)
-- @relation directive 박제 신설 → PG FK 제약 영역 적용
-- ──────────────────────────────────────────────────────────────────────

-- credit_logs.author_id → Restrict (회계 영구 보존, 단계 2 archive 1 row 박제 영역 정합)
ALTER TABLE "credit_logs" ADD CONSTRAINT "credit_logs_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- bookmarks (raw FK 2건, Cascade)
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- reading_progress (raw FK 2건, Cascade)
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- likes (raw FK 2건, SetNull + Cascade)
ALTER TABLE "likes" ADD CONSTRAINT "likes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "likes" ADD CONSTRAINT "likes_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- subscriptions (raw FK 2건, Cascade, self-ref Subscriber/TargetAuthor)
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_target_author_id_fkey" FOREIGN KEY ("target_author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- comments.author + comments.episode (raw FK 2건, SetNull + Cascade)
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- payments.author_id → Restrict (회계 영구 보존)
ALTER TABLE "payments" ADD CONSTRAINT "payments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- daily_views.work_id → Cascade
ALTER TABLE "daily_views" ADD CONSTRAINT "daily_views_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- chat_sessions (raw FK 2건, Cascade)
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- featured_works (raw FK 2건, Cascade + SetNull, admin_id Optional 변경 직후)
ALTER TABLE "featured_works" ADD CONSTRAINT "featured_works_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "featured_works" ADD CONSTRAINT "featured_works_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- user_sanctions (raw FK 2건, Restrict + SetNull, self-ref SanctionedAuthor/SanctioningAdmin, admin_id Optional 변경 직후)
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- reports (raw FK 2건, SetNull, self-ref Reporter/Resolver)
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- access_logs.author_id → SetNull (보안 감사 영구 보존, 익명화)
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- refresh_tokens.author_id → Cascade (Author 삭제 시 즉시 무효)
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- analysis_reports.author_id → Restrict (환불 추적 + 감사 영구 보존)
ALTER TABLE "analysis_reports" ADD CONSTRAINT "analysis_reports_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- admin_audit_logs.admin_id → Restrict (감사 영구 보존, 단계 2 archive 2 row 박제 영역 정합)
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- refund_logs.payment_id → Restrict (회계/세무 영구 보존)
ALTER TABLE "refund_logs" ADD CONSTRAINT "refund_logs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
