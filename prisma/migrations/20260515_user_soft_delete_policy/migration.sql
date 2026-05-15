-- Sprint USER-SOFT-DELETE — Author Soft Delete + 본인 탈퇴 + 운영자 강제 삭제 + GDPR 익명화 + 30일 cron hard delete
-- 사용자 5/15 verbatim 정합 ("B + A 모두 진행" / 5/10 "USER-SOFT-DELETE ... 이건 순서대로")
-- §16 6 결정 영역 옵션 A 채택 5건 전부 정합 (User soft delete A / 작품 cascade A / GDPR basic A / 30일 cron A / cron 시간 0 4 * * * A)
-- 정본: .claude/state/sprint-user-soft-delete-draft.md §8 dev migration apply 영역

-- (1) Author.deletedAt 컬럼 신설 (NULL ALLOW, default NULL 영역)
ALTER TABLE "authors" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

-- (2) deletedAt 인덱스 신설 (cron 영역 정합 — 30일 deletedAt < now() - 30일 검색 영역)
CREATE INDEX "authors_deleted_at_idx" ON "authors"("deleted_at");
