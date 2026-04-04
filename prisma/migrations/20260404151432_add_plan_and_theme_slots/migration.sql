-- AlterTable
ALTER TABLE "authors" ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "plan_expire_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "themes" ADD COLUMN     "is_slotted" BOOLEAN NOT NULL DEFAULT true;
