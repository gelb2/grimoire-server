-- DropForeignKey
ALTER TABLE "themes" DROP CONSTRAINT "themes_author_id_fkey";

-- AlterTable
ALTER TABLE "themes" ALTER COLUMN "is_slotted" SET DEFAULT false;

-- AddForeignKey
ALTER TABLE "themes" ADD CONSTRAINT "themes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
