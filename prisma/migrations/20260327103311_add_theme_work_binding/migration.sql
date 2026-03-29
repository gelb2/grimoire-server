-- DropIndex
DROP INDEX "themes_author_id_key";

-- AlterTable
ALTER TABLE "authors" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "default_theme_id" TEXT,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'user';

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "parent_id" TEXT;

-- AlterTable
ALTER TABLE "episodes" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'episode';

-- AlterTable
ALTER TABLE "themes" ADD COLUMN     "name" TEXT NOT NULL DEFAULT '기본 테마';

-- AlterTable
ALTER TABLE "works" ADD COLUMN     "cover_image" TEXT,
ADD COLUMN     "theme_id" TEXT;

-- CreateTable
CREATE TABLE "daily_views" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_views_work_id_date_key" ON "daily_views"("work_id", "date");

-- CreateIndex
CREATE INDEX "bookmarks_author_id_idx" ON "bookmarks"("author_id");

-- CreateIndex
CREATE INDEX "comments_episode_id_created_at_idx" ON "comments"("episode_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_parent_id_idx" ON "comments"("parent_id");

-- CreateIndex
CREATE INDEX "episodes_work_id_order_num_idx" ON "episodes"("work_id", "order_num");

-- CreateIndex
CREATE INDEX "themes_author_id_idx" ON "themes"("author_id");

-- CreateIndex
CREATE INDEX "works_author_id_idx" ON "works"("author_id");

-- AddForeignKey
ALTER TABLE "works" ADD CONSTRAINT "works_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
