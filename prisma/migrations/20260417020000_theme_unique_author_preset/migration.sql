-- 같은 작가가 같은 프리셋으로 중복 테마 생성 방지
-- author_id가 NULL인 시스템 테마는 제외 (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS "themes_author_preset_source_unique" 
ON "themes" ("author_id", "preset", "source") 
WHERE "author_id" IS NOT NULL;
