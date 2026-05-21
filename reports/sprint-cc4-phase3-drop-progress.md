# CC-4 Phase 3 — `Author.credits` DROP + `CreditLog` 폐기 진행 박제

> 작성: 2026-05-21 / grimoire-server (Generator)
> 정본 계획: `.claude/state/sprint-cc4-phase3-drop-plan-draft.md` (sub-task 24개)
> 정본 진단: `reports/CREDIT_CORE_DIAGNOSIS.md` §2-3 / §5-A / §8
> 인터페이스 박제: `.claude/shared-contracts.md` §13 + §30 (변경 이력 1줄 추가)
> 사용자 키워드 게이트 사전 통과(5/21 박제): "Author.credits DROP + CreditLog 폐기 prod migration 진행"
> 案 P3-Y + 案 P3-Y-a + 옵션 A 채택 (응답 키 `credits` 보존, 값 = `ledger.getBalance().total` 매핑)

## 1. S0 — 잔존 사용처 + FK + DB 상태 + web 영향 박제

| sub-task | 결과 |
|---|---|
| S0a `Author.credits` grep | 41건 — production 코드: ① schema.prisma:26 컬럼 정의 ② auth.controller:48 응답 직렬화 ③ refund-payment.usecase:124-125 폴백 ④ credit-migration.ts:54,58,84-85 디노미 도구 ⑤ prisma-author.repository:248,299,344 매핑 + updateCredits 메서드 ⑥ Author 도메인 model:13 필드 정의. 나머지 = 박제 주석. |
| S0b `CreditLog` grep | 40건 — production: ① schema.prisma:55,154-163 ② credit.ts:CreditLog interface ③ credit-repository.port.ts:CreditRepositoryPort interface ④ prisma-credit.repository.ts(전체 파일) ⑤ credit.usecase.ts:`creditRepo` 폴백 분기 ⑥ app.module.ts:179 DI provider ⑦ admin.controller.ts:214 `getCreditLogs`(이름만 — 신 ledger 위임 / 외부 admin endpoint 호환성). |
| S0c FK 의존성 + DROP 순서 | `credit_logs.author_id` FK = Restrict(ADR-007). DROP TABLE `CASCADE`로 자동 정리(FK + 인덱스 동시 DROP). `Author.creditLogs CreditLog[]` 관계는 schema.prisma 측 제거 후 prisma migrate 자동 정합. `Author.credits` 컬럼 DROP은 FK 무관(단순 컬럼) — `ALTER TABLE "authors" DROP COLUMN "credits"`. |
| S0d 로컬 DB 상태 | `authors`: 11 rows / sum(credits)=110 / nonzero=11 (V Phase 환산 후 의미 폐기 — 안전한 손실). `credit_logs`: 0 rows. pg_dump 백업 6.1KB. `prisma migrate status` "up to date". |
| S0e web 영향 | (계획서 박제 — 案 P3-Y 옵션 A 채택으로 web 코드 변경 0건. data-model.md + api-contract.md docs sync only는 F2g 영역). |
| S0f webhook 응답 키 | 案 P3-Y-a 채택 — `processNormalizedWebhook` 반환 `{ processed, credits, deficitCredits? }` Phase 2 박제 그대로 보존(외부 호환성 + DLQ retry consumer 영향 회피). Phase 4 또는 별도 sprint로 분리. |

## 2. Prisma schema 변경 + 마이그레이션 SQL

### 2-1. schema.prisma 변경

- `model Author` `credits Int @default(0)` 컬럼 제거 (line 23-26 박제 주석 4줄 갱신 — CC-4 Phase 3 DROP 정합).
- `model Author` `creditLogs CreditLog[]` 관계 line 55 제거 (Restrict 영역 주석 갱신).
- `model CreditLog` 모델 전체(line 154-163) 제거.
- 박제 주석 1줄 추가: `/// [CC-4 Phase 3 — 2026-05-21] model CreditLog 폐기 — 4 출처 신 ledger(CreditLedger)가 단일 정본. 마이그레이션: 20260521_author_credits_drop_credit_log_phase3.`
- `npx prisma format` PASS / `npx prisma generate` PASS — Prisma client 타입 `Author.credits` 부재 + `CreditLog` 모델 부재 정합.

### 2-2. 마이그레이션 SQL

- 경로: `prisma/migrations/20260521_author_credits_drop_credit_log_phase3/migration.sql`
- 내용 (비가역):

```sql
-- §A. authors.credits 컬럼 DROP
ALTER TABLE "authors" DROP COLUMN "credits";

-- §B. credit_logs 테이블 DROP (FK + 인덱스 CASCADE)
DROP TABLE IF EXISTS "credit_logs" CASCADE;
```

- 박제 주석 ~22줄 (CC-4 Phase 3 비가역 + 사용자 게이트 박제 + pg_dump 백업 의무 + 사후 검증 SQL 4건 + 정본 다발 참조).

## 3. 코드 잔존 제거 영향 파일 목록

| 파일 | 변경 |
|---|---|
| `src/adapter/inbound/http/controller/auth.controller.ts` | `userResponse` 시그니처 변경(`credits: number` 매개변수 → `credits` 인자 별도 받음) + `AuthController` 생성자 `CreditLedgerPort` Optional DI + `resolveCredits` 헬퍼 + 5 핸들러(register/login/google/refresh/profile)에서 `userResponse(author, await this.resolveCredits(author.id))` 호출. 案 P3-Y 옵션 A 적용 — 응답 키 `credits` 보존, 값 = `ledger.getBalance().total` 매핑(미주입/throw 시 0 폴백). |
| `src/application/payment/refund-payment.usecase.ts` | 생성자 `AuthorRepositoryPort` Optional Inject 제거 (3 인자 → 2 인자: paymentRepo + auditLog + ledger?). `import AuthorRepositoryPort` 제거. `else if (this.authorRepo)` 폴백 분기 22줄 본문 제거 — `author.credits ?? 0` 의존 0건. |
| `src/application/credit/credit.usecase.ts` | `import { CreditRepositoryPort }` + `import { CreditLog }` 제거. 생성자 `@Inject('CreditRepositoryPort')` Inject 제거 (4 인자 → 3 인자: authorRepo + ledger? + membershipRepo?). `getGiftRanking`/`getLogs` ledger 미주입 폴백 분기 → BadRequest. `getLogs` 반환 타입 `CreditLedgerEntry[] | CreditLog[]` → `CreditLedgerEntry[]` 단일. |
| `src/adapter/outbound/persistence/prisma-author.repository.ts` | `updateCredits(id, credits)` 메서드 본문 제거. `findById`/`findDeletedById`/`findDeletedOlderThan` raw query 타입 `credits: number` 제거 + 매핑 `credits: row.credits` 3건 제거. `toDomain` 함수 타입 + 매핑에서 `credits` 제거. |
| `src/domain/model/author.ts` | `Author.credits: number` 필드 제거 + 박제 주석 갱신(案 P3-Y 옵션 A 정합). |
| `src/domain/port/outbound/author-repository.port.ts` | `updateCredits(id, credits): Promise<Author>` 시그니처 제거 + 박제 주석. |
| `src/domain/model/index.ts` | `export * from './credit'` 제거 + 박제 주석. |
| `src/app.module.ts` | `import { PrismaCreditRepository }` 제거 + `{ provide: 'CreditRepositoryPort', useClass: PrismaCreditRepository }` provider 제거. 박제 주석 2줄. |
| `scripts/seed-admin.ts` | `credits: 0` create 필드 제거. |
| `scripts/seed-all.ts` | `credits: 10` create/update 필드 제거. |
| `scripts/seed-themes.ts` | `credits: 10` create/update 필드 제거. |
| `scripts/seed-more-classics.ts` | `credits: 3` create 필드 제거(2건). |
| `scripts/db-sync.ts` | `creditLog.findMany`/`deleteMany`/`create` 호출 + `creditLogs` 변수 제거. 3 박제 주석. |

## 4. 파일/Port 삭제 결과

| 파일 | 결과 |
|---|---|
| `src/adapter/outbound/persistence/prisma-credit.repository.ts` | DELETED — `PrismaCreditRepository` 클래스 + `findLogsByAuthorId`/`getGiftRanking` 폴백 2종 + `toDomain` 헬퍼. |
| `src/domain/port/outbound/credit-repository.port.ts` | DELETED — `CreditRepositoryPort` interface. |
| `src/domain/model/credit.ts` | DELETED — `CreditLog` interface. |
| `src/domain/model/credit-migration.ts` | DELETED — `expectMigratedAuthor`/`migrationIntegrityCriteria`/`PreMigrationAuthor` 등 V Phase 마이그레이션 1회 사용 도구(案 P3-d-X). |
| `src/domain/model/credit-migration.spec.ts` | DELETED — `credit-migration.ts` 의존 spec 동시 제거. |

## 5. auth.controller:48 응답 키 案 P3-Y 옵션 A 정합 확인

- 응답 키 `credits` **보존** (web 영향 0건 — 案 P3-Y 옵션 A 박제).
- 값 매핑: `creditLedger.getBalance(author.id).total` (4 출처 합 pt 단위). 미주입/throw 시 0 폴백(silent log + lazy 안전망 패턴).
- 5 핸들러(register/login/google/refresh/profile) 모두 `userResponse(author, await this.resolveCredits(author.id))` 호출.
- `AuthController` 생성자 `CreditLedgerPort` Optional Inject — 실 운영 `app.module.ts`에서는 항상 주입.
- `userResponse` 시그니처 `(author: {...}, credits: number)` — `Author.credits` 도메인 model 필드 부재 정합.

## 6. 로컬 DB 마이그레이션 apply + 사후 검증 SQL

### 6-1. pg_dump 백업

`pg_dump -h localhost -U grimoireadmin -d grimoire --table=authors --table=credit_logs > /tmp/grimoire_backup/backup_pre_phase3_local_20260521_211243.sql` (6.1KB).

### 6-2. migrate deploy

`npx prisma migrate deploy` PASS — `20260521_author_credits_drop_credit_log_phase3` 1건 apply 성공.

### 6-3. 사후 검증 SQL (5건 PASS)

| # | SQL | 기대값 | 결과 |
|---|-----|--------|------|
| ① | `SELECT column_name FROM information_schema.columns WHERE table_name='authors' AND column_name='credits';` | 0 rows | **PASS — 0 rows** (authors.credits 컬럼 부재) |
| ② | `SELECT table_name FROM information_schema.tables WHERE table_name='credit_logs';` | 0 rows | **PASS — 0 rows** (credit_logs 테이블 부재) |
| ③ | `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='authors' AND column_name IN ('points_free','points_subscription','points_gift','points_charged','deficit_points') ORDER BY column_name;` | 5 rows integer | **PASS — 5 rows** (신 4 출처 + deficit 정합) |
| ④ | `SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name='20260521_author_credits_drop_credit_log_phase3';` | 1 row + finished_at NOT NULL | **PASS — 1 row finished_at=2026-05-21 21:12:52** |
| ⑤ | `SELECT COUNT(*) FROM payments WHERE points > 0;` (Phase 2 회귀) | 로컬은 0 (결제 0건) | **PASS — 0 rows** (Phase 2 정합 회귀 0건) |

### 6-4. `prisma migrate status`

`Database schema is up to date!` — 35 migrations apply 완료.

## 7. 빌드 / jest / 커버리지

| 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` | PASS (무에러) |
| `npm run build` (`nest build`) | PASS |
| `npm test` | 74 suites / **1054 tests PASS** (Phase 3 통합 spec 3건 추가 — 1051→1054) |
| 커버리지 | **61.66%(stmts) / 63.23%(lines)** — 게이트 ≥60% 충족 |

## 8. 완료 게이트 + DROP 증명

### 8-1. 게이트

- ✅ Gate 1 — `npm run build` 무에러.
- ✅ Gate 2 — `npm test` 전체 PASS + 커버리지 ≥60% + 코드 본문 `Author.credits`/`CreditLog` 참조 0건 grep.
- ✅ Gate 3 — `shared-contracts §30 + §13` + `TECH_STATUS.md` + `docs/data-model.md` + `docs/api-contract.md` 갱신.
- ✅ 마이그레이션 파일 생성 + 로컬 apply 성공 + 검증 SQL 5건 PASS.

### 8-2. DROP 증명 grep

```bash
# 1. authors 테이블 credits 컬럼 부재
psql ... -c "SELECT column_name FROM information_schema.columns WHERE table_name='authors' AND column_name='credits';"
# 결과: 0 rows

# 2. credit_logs 테이블 부재
psql ... -c "SELECT table_name FROM information_schema.tables WHERE table_name='credit_logs';"
# 결과: 0 rows

# 3. 코드 본문 author.credits 호출 0건 (주석/박제 제외)
grep -rn "\.credits\b" src --include="*.ts" --exclude="*.spec.ts" | grep -v "//\|/\*"
# 결과: 0 rows (production code body)

# 4. 4 파일 삭제 확인
ls src/adapter/outbound/persistence/prisma-credit.repository.ts → No such file
ls src/domain/port/outbound/credit-repository.port.ts → No such file
ls src/domain/model/credit.ts → No such file
ls src/domain/model/credit-migration.ts → No such file
```

## 9. 발견 사항

1. **scripts/ 디렉토리 tsc 대상** — `tsconfig.json` `include` 미지정 + 기본 동작으로 scripts/ 도 tsc 검사 대상. `Author.credits` create/update + `creditLog` Prisma 호출 잔존 발견 → 5 파일(seed-admin/seed-all/seed-themes/seed-more-classics/db-sync) 일괄 정리(코드 본문 제거 + 박제 주석). 향후 새 컬럼 추가 시 scripts/ 정합 검증 강제 필요.
2. **응답 키 `credits` 의미 변경 박제 필요** — `/auth/me` 응답 키 `credits` 보존(案 P3-Y 옵션 A)이지만 **값 단위 변경**(구 정수 "N크레딧" → pt "N pt"). 디노미 1:1,000. web 표시 시 환산(`point-balance.ts` 패턴). docs/api-contract.md `### POST /api/auth/register` 등 4 엔드포인트 응답 예시 + 박제 주석 갱신(`"credits": 3` → `"credits": 3000`).
3. **`prisma-fk-cascade.spec.ts` Restrict 8건 박제** — PAY-P3-E 마이그레이션 SQL 박제 검증 spec. 비가역 SQL 박제는 보존하되 schema.prisma 측 정합 검증(`CreditLog` 모델 부재 박제)을 추가하여 정합 종결.
4. **HIGH-1 案 B = Case C 별도 sprint** — `Author.plan` 정본 유지(案 A) — Phase 3에서 미시행. CC-3 案 A 동기로 안정화 완료(ADR-014). HIGH-1 案 B 별도 sprint(사용자 결정 5/21 박제).
5. **CC-4 sprint 전체 종결 박제** — Phase 1(구 메서드 제거) + Phase 2(Payment.credits→points rename) + Phase 3(Author.credits DROP + CreditLog 폐기) = 크레딧 디노미네이션 + 4 출처 회계 시스템 단일 정본 종결. dev/prod migration apply는 grimoire-infrastructure 영역(별도 핸드오프).
6. **web 핸드오프 = docs sync only** — 案 P3-Y 옵션 A 채택으로 web 코드 변경 0건. `data-model.md` + `api-contract.md` cp만(grimoire-web agent 영역).
7. **Phase 4 응답 일관성 정합** (`processNormalizedWebhook` 반환 키 `{credits, deficitCredits}` → `{points, deficitPoints}` 정합)은 외부 호환성 영향 평가 종속 별도 sprint(案 P3-Y-a 채택으로 Phase 3 범위 외).

---

**산출물**: feature/cc4-phase3-drop 브랜치 — Phase 3 sprint 전체 종결 박제. develop 머지 후 grimoire-qa(Evaluator) 채점 + grimoire-web(docs sync) + grimoire-infrastructure(dev/prod migration) 핸드오프.
