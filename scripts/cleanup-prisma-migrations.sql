-- _prisma_migrations 히스토리 정비 스크립트
-- 용도: 수동 재작성으로 남은 잔존 레코드 정리
-- 실행 전 반드시 현재 상태 확인: SELECT * FROM _prisma_migrations ORDER BY finished_at;

-- 1. 현재 상태 확인 (먼저 실행해서 결과 확인)
SELECT migration_name, started_at, finished_at, applied_steps_count, logs
FROM _prisma_migrations
ORDER BY started_at;

-- 2. 마이그레이션 파일에 없는 레코드 식별
-- 아래 목록이 prisma/migrations/ 디렉토리와 일치하는지 수동 확인
-- 기대 목록:
--   20260326091237_init
--   20260327103311_add_theme_work_binding
--   20260330064541_add_episode_description
--   20260331103549_add_episode_status
--   20260331120000_rename_payapp_trade_no_to_external_transaction_id
--   20260402082750_add_anonymous_social
--   20260404151432_add_plan_and_theme_slots
--   20260404193946_add_chat_session_message
--   20260405112613_add_work_context_instructions
--   20260405114805_add_episode_is_indexed
--   20260407140000_add_theme_source
--   20260407160644_change_isslotted_default_false
--   20260407180000_system_presets
--   20260411000000_unify_timestamp_to_timestamptz

-- 3. 파일에 없는 레코드 삭제 (위 목록에 없는 migration_name)
-- 아래 WHERE 조건은 실제 확인 후 수정해서 사용
-- DELETE FROM _prisma_migrations
-- WHERE migration_name NOT IN (
--   '20260326091237_init',
--   '20260327103311_add_theme_work_binding',
--   '20260330064541_add_episode_description',
--   '20260331103549_add_episode_status',
--   '20260331120000_rename_payapp_trade_no_to_external_transaction_id',
--   '20260402082750_add_anonymous_social',
--   '20260404151432_add_plan_and_theme_slots',
--   '20260404193946_add_chat_session_message',
--   '20260405112613_add_work_context_instructions',
--   '20260405114805_add_episode_is_indexed',
--   '20260407140000_add_theme_source',
--   '20260407160644_change_isslotted_default_false',
--   '20260407180000_system_presets',
--   '20260411000000_unify_timestamp_to_timestamptz'
-- );

-- 4. production에서 이미 timestamptz인 경우, 새 마이그레이션을 수동 등록
-- (prisma migrate deploy가 이미 timestamptz인 컬럼에 ALTER하면 no-op이므로 안전)
-- 만약 deploy가 실패한다면 아래로 수동 등록:
-- INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
-- VALUES (gen_random_uuid(), '', '20260411000000_unify_timestamp_to_timestamptz', NOW(), NOW(), 1);
