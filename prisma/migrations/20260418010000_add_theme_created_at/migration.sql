-- Theme 테이블에 created_at 컬럼 추가
-- 목적: 테마 목록 정렬을 생성 순으로 고정하기 위해 (id asc 임시 방편 대체)
--
-- 기존 레코드는 updated_at 값을 created_at으로 복사한다.
-- (updated_at이 "최초 생성 + 최종 수정" 값이라 실제 생성 시점과 다를 수 있지만,
--  레코드 최초 INSERT 시 updated_at도 동일 값으로 채워지므로 가장 가까운 값)

ALTER TABLE "themes"
  ADD COLUMN "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 기존 레코드: updated_at을 created_at으로 복사 (현재시간 대신 기존 수정 시점 사용)
UPDATE "themes"
  SET "created_at" = "updated_at"
  WHERE "created_at" > "updated_at";
