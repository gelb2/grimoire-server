-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "nickname" TEXT,
ADD COLUMN     "password_hash" TEXT,
ALTER COLUMN "author_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "likes" ADD COLUMN     "cookie_id" TEXT,
ADD COLUMN     "ip_address" TEXT,
ALTER COLUMN "author_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "likes_episode_id_idx" ON "likes"("episode_id");

-- CreateIndex
CREATE INDEX "likes_ip_address_cookie_id_episode_id_idx" ON "likes"("ip_address", "cookie_id", "episode_id");
