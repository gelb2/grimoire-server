/*
  Warnings:

  - A unique constraint covering the columns `[shared_token]` on the table `episodes` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "episodes" ADD COLUMN     "shared_expire_at" TIMESTAMP(3),
ADD COLUMN     "shared_token" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'upload';

-- CreateIndex
CREATE UNIQUE INDEX "episodes_shared_token_key" ON "episodes"("shared_token");
