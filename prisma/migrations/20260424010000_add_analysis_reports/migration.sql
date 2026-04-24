-- CreateTable
CREATE TABLE "analysis_reports" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "work_title" TEXT NOT NULL,
    "episode_title" TEXT NOT NULL,
    "types" TEXT[],
    "results" JSONB NOT NULL,
    "credits_charged" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analysis_reports_author_id_created_at_idx" ON "analysis_reports"("author_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "analysis_reports_episode_id_idx" ON "analysis_reports"("episode_id");
