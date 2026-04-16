-- 테마 기본 이름을 "기본 테마" → "내 테마"로 변경
ALTER TABLE themes ALTER COLUMN name SET DEFAULT '내 테마';
