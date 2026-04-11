-- 공지사항
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "target" TEXT NOT NULL DEFAULT 'all',
    "admin_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "announcements_created_at_idx" ON "announcements"("created_at");

-- 추천 작품
CREATE TABLE "featured_works" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT 'main',
    "position" INT NOT NULL DEFAULT 0,
    "start_at" TIMESTAMPTZ(3),
    "end_at" TIMESTAMPTZ(3),
    "admin_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "featured_works_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "featured_works_section_position_idx" ON "featured_works"("section", "position");
