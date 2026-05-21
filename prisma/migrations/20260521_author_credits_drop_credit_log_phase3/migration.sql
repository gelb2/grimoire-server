-- CC-4 Phase 3 (2026-05-21) — Author.credits 컬럼 + CreditLog 테이블 폐기.
-- 비가역 — pg_dump 백업 필수 + 사용자 키워드 게이트 통과(5/21 박제):
--   "Author.credits DROP + CreditLog 폐기 prod migration 진행"
--
-- 정본:
--   - reports/CREDIT_CORE_DIAGNOSIS.md §2-3 폐기 의존 그래프
--   - .claude/state/sprint-cc4-phase3-drop-plan-draft.md §4 (M1a~M1c) + §5-2 사후 검증 SQL
--   - .claude/shared-contracts.md §30 CreditOverhaul (변경 이력 박제)
--   - reports/sprint-cc4-phase3-drop-progress.md
--
-- 변경 내용:
--   §A. `authors.credits` Int 컬럼 DROP (V Phase 마이그레이션에서 `points_charged = credits × 1,000`
--       환산 후 신 4 출처 캐시로 이행 완료, prod rev 103 — 5/21. 의미 폐기 정합).
--   §B. `credit_logs` 테이블 DROP (CC-1·CC-2a·CC-2b·CC-3에서 적립/차감 8경로 전부 신 `CreditLedger`로
--       이행 완료. 잔존 폴백 코드 + 파일/Port 제거 정합 — CC-4 Phase 3 코드 단계 박제).
--
-- 의존 정합:
--   - `credit_logs.author_id` FK (Restrict, ADR-007) → DROP TABLE CASCADE로 자동 정리(FK 제약 + 인덱스 동시 DROP).
--   - `Author.creditLogs` Prisma 관계 → schema.prisma 측 제거 완료(M1a). prisma migrate diff 정합.
--
-- 롤백:
--   - 비가역 — pg_dump 백업(`pg_dump --table=authors --table=credit_logs`) 복원만 가능.
--   - dev/prod 양쪽 마이그레이션 직전 백업 의무.

-- §A. authors.credits 컬럼 DROP
ALTER TABLE "authors" DROP COLUMN "credits";

-- §B. credit_logs 테이블 DROP (FK + 인덱스 CASCADE)
DROP TABLE IF EXISTS "credit_logs" CASCADE;
