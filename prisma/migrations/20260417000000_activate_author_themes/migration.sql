-- 기존 작가 테마 중 첫 번째를 슬롯 배정 + 기본 테마로 활성화
-- (is_slotted=false인 작가 테마가 있지만 활성화되지 않은 문제 수정)

-- Step 1: 각 작가의 가장 최근 테마를 슬롯에 배정
UPDATE themes SET is_slotted = true
WHERE id IN (
  SELECT DISTINCT ON (author_id) id
  FROM themes
  WHERE author_id IS NOT NULL AND source != 'system' AND is_slotted = false
  ORDER BY author_id, updated_at DESC
)
AND NOT EXISTS (
  SELECT 1 FROM themes t2 WHERE t2.author_id = themes.author_id AND t2.is_slotted = true
);

-- Step 2: default_theme_id가 null인 작가에게 슬롯된 첫 번째 테마를 기본 테마로 설정
UPDATE authors SET default_theme_id = (
  SELECT id FROM themes
  WHERE themes.author_id = authors.id AND themes.is_slotted = true
  ORDER BY themes.updated_at DESC LIMIT 1
)
WHERE default_theme_id IS NULL
AND EXISTS (SELECT 1 FROM themes WHERE themes.author_id = authors.id AND themes.is_slotted = true);
