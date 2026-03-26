-- CreateTable
CREATE TABLE "authors" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "themes" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "preset" TEXT NOT NULL DEFAULT 'midnight',
    "overrides" JSONB,
    "raw_description" TEXT,
    "baked_css_url" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "works" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "order_num" INTEGER NOT NULL,
    "blocks" JSONB NOT NULL,
    "raw_md" TEXT NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "source_format" TEXT NOT NULL DEFAULT 'markdown',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_logs" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signup_history" (
    "provider_id" TEXT NOT NULL,
    "first_signup_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signup_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "signup_history_pkey" PRIMARY KEY ("provider_id")
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_progress" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "block_index" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reading_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "likes" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "target_author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "payapp_trade_no" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "authors_slug_key" ON "authors"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "authors_email_key" ON "authors"("email");

-- CreateIndex
CREATE UNIQUE INDEX "themes_author_id_key" ON "themes"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "works_author_id_slug_key" ON "works"("author_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_work_id_slug_key" ON "episodes"("work_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_provider_provider_id_key" ON "social_accounts"("provider", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_author_id_episode_id_key" ON "bookmarks"("author_id", "episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "reading_progress_author_id_episode_id_key" ON "reading_progress"("author_id", "episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "likes_author_id_episode_id_key" ON "likes"("author_id", "episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_subscriber_id_target_author_id_key" ON "subscriptions"("subscriber_id", "target_author_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payapp_trade_no_key" ON "payments"("payapp_trade_no");

-- AddForeignKey
ALTER TABLE "themes" ADD CONSTRAINT "themes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "works" ADD CONSTRAINT "works_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
