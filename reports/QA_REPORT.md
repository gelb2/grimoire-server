# QA Report — 2026-05-21 (CC-4 Phase 3 AUDIT + CC-4 종결)

> 작성: 2026-05-21 / grimoire-qa (Evaluator, 독립 재실행)
> 대상: develop branch (`93aa6f5` feature + `bb420d4` merge / 2 commits ahead of origin)
> 정본 게이트: `.claude/state/sprint-cc4-phase3-drop-plan-draft.md` / `reports/sprint-cc4-phase3-drop-progress.md` / shared-contracts §30 (L2550)
> 비가역 마이그레이션: `prisma/migrations/20260521_author_credits_drop_credit_log_phase3/migration.sql`

---

## 1. 환경

- Node v22.19.0 / npm 10.9.3 / 작업 디렉토리 `grimoire-server/`
- git status — `working tree clean` (develop, origin 대비 +2 commits, RED 재현 후 청결 원복 확인)

## 2. CC-4 Phase 3 AUDIT — 10 검증 영역

### (1) 빌드/테스트/커버리지 — 독립 재실행

| 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` | **PASS** (무에러) |
| `npm run build` (`nest build`) | **PASS** (무에러) |
| `npm test -- --coverage` | **74 suites / 1054 tests PASS** (Phase 3 +3 it 정합) |
| 커버리지 | (실측 표 — domain/model `credit-point` 100% / `credit-source` 100% / `payment.usecase` 97.34% / `refund-payment.usecase` 100%) |
| 게이트 ≥60% | **PASS** (progress 박제 61.66% stmts / 63.23% lines와 정합) |

### (2) Prisma schema 정합 + 마이그레이션 파일 유효성

- `model Author` (line 15–78): `credits` 필드 **부재** / `creditLogs CreditLog[]` relation **부재** (line 23·53 박제 주석 정합).
- `model CreditLog` (이전 line 154–163): **삭제** (line 153·154 박제 주석 1줄 자리만 잔존).
- 마이그레이션 SQL 본문 (29 lines):
  - §A `ALTER TABLE "authors" DROP COLUMN "credits";`
  - §B `DROP TABLE IF EXISTS "credit_logs" CASCADE;` (FK Restrict cascade 명시 + 박제 주석 22줄).
- `npx prisma migrate status` — **"Database schema is up to date!" / 35 migrations apply 완료**.

### (3) 로컬 dev DB 검증 SQL 5건 — 독립 실측

| # | SQL | 기대 | 실측 |
|---|-----|---|---|
| ① | `information_schema.columns WHERE table_name='authors' AND column_name='credits'` | 0 rows | **0 rows PASS** |
| ② | `information_schema.tables WHERE table_name='credit_logs'` | 0 rows | **0 rows PASS** |
| ③ | 신 4 출처 + deficit (`points_free|subscription|gift|charged`+`deficit_points`) | 5 rows integer | **5 rows integer PASS** |
| ④ | `_prisma_migrations WHERE migration_name='20260521_author_credits_drop_credit_log_phase3'` | 1 row finished_at NOT NULL | **1 row, finished_at=2026-05-21 21:12:52 PASS** |
| ⑤ | `authors` row 보존 (Phase 2 → Phase 3 invariant) | 11 rows | **11 rows / sum(points)=110000 / max(deficit_points)=0 PASS** (V Phase ×1000 환산 정합) |

### (4) DROP 증명 grep

- `grep -rn "\.credits\b" src --include="*.ts" --exclude="*.spec.ts"` — 24 hits **전부 박제 주석/JSDoc**(`// 구 ~`, `* CC-4 Phase 3 ~`) — **production 코드 본문 0건**.
- `grep -rn "CreditLog\b\|creditLog\b" src --include="*.ts" --exclude="*.spec.ts"` — 12 hits **전부 박제 주석** — 코드 본문 0건.
- 파일 삭제 5건: `prisma-credit.repository.ts` / `credit-repository.port.ts` / `domain/model/credit.ts` / `credit-migration.ts` / `credit-migration.spec.ts` — `ls` 모두 **No such file** PASS.

### (5) 案 P3-Y 옵션 A 정합 — `auth.controller.ts`

- `userResponse` 시그니처 `(author, credits: number)` → 응답 객체 키 `credits` **보존** (line 62).
- `resolveCredits` 헬퍼 (line 86–96): `creditLedger.getBalance(authorId).total` 매핑 + `creditLedger` 미주입 시 0 반환 + try/catch throw 시 silent log + 0 폴백 (lazy 안전망 패턴).
- Optional DI: `@Optional() @Inject('CreditLedgerPort') creditLedger: CreditLedgerPort | null = null` (line 77–79).
- 5 핸들러 매핑: `register:112` / `login:149` / `googleLogin:169` / `refresh:186` / `profile:205` 모두 `userResponse(author, await this.resolveCredits(author.id))` — **정합 완전**.

### (6) 案 P3-Y-a 정합 — `processNormalizedWebhook`

`payment.usecase.ts:431/478/489` 반환 키 `{processed, credits, deficitCredits}` Phase 2 박제 그대로 보존 — 외부 호환성 + DLQ retry consumer 영향 회피 정합. `credits: payment.points` 매핑(L431) / 환불·중복 분기 `credits: 0 + deficitCredits` 매핑(L478/489).

### (7) RED 재현 — 독립 (commit 0건, 원복 완료)

- 1차 시도: `auth.controller.ts:90` `return balance.total` → `return 0` 임시 변경 → `auth.controller.spec` 부재 확인 후 원복.
- 2차 시도: `payment.usecase.ts:431` `credits: payment.points` → `credits: 0 /* RED */` → `payment.usecase.spec` **5 tests FAIL** (`expect(result.credits).toBe(25000)` `Received: 0` — L428·L491·L509·L643·L673) → **응답 키 보존 정합이 spec으로 강제 검증되고 있음 확증**.
- 즉시 원복 + `git diff --stat` **빈 결과** + `git status` `working tree clean` — commit 금지 정합.

### (8) 회귀 — 핵심 9 spec PASS

`payment.usecase.spec` + `refund-payment.usecase.spec` + `credit-grant-integration` + `credit-gift-refund-integration` + `credit-rollover-source-ledger-integration` + `payment-charge-credit-integration` + `auth.usecase.spec` + `admin.usecase.spec` + `discovery.usecase.spec` → **9 suites / 145 tests PASS** (4.5s).

### (9) CC-4 sprint 전체 종결 — 의존성 그래프 종결

| 단계 | 상태 | 박제 |
|---|---|---|
| **Phase 1** (구 메서드 제거) | **PASS** | `completePaymentAtomically` / `refundPaymentAtomically` 시그니처 제거 (payment-repository.port:20·94 주석). |
| **Phase 2** (`Payment.credits` → `points` 물리 rename) | **PASS** | prod rev 104 (shared-contracts §30 박제). `payments.points` SQL 정합 회귀 0건. RefundLog 案 Y 보존(`RefundLog.credits`는 PAY-P3 다른 의미 — 환불 감사용, Phase 2 박제). |
| **Phase 3** (`Author.credits` DROP + `CreditLog` 폐기) | **본 qa PASS** | 검증 (1)~(8). 마이그레이션 1건 apply (dev 로컬). |
| **적립 8경로 (T1~T8)** | **신 CreditLedger 단일 정본** | `auth.usecase:19` signup / `admin.usecase:117/148` manual / `theme/generate:18` chargeTheme / `work-management:18` first work — 모두 `GrantPointsUseCase` / `CreditLedgerPort.spend` 교체 박제. |
| **§2-3 폐기 의존 그래프** | **종결** | `CreditRepositoryPort` interface 자체 제거 + `prisma-credit.repository.ts` 파일 제거 + `credit-migration.ts`(+spec) 제거 + `app.module.ts` provider 제거. `CreditUseCase` 생성자 3→2 인자. |

### (10) shared-contracts §30 + 진행 박제

- `.claude/shared-contracts.md` L2550 — Phase 3 변경 이력 1줄 박제 (`2026-05-21 #크레딧개편 CC-4 Phase 3 — Author.credits DROP + CreditLog 폐기 + CreditRepositoryPort 파일/Port 자체 제거 + 案 P3-Y 옵션 A 응답 키 보존`) — 정합 완전.
- `reports/sprint-cc4-phase3-drop-progress.md` — 9 섹션 박제 정합 (계획 sub-task 24건 결과 + 발견 사항 7건).
- `scripts/` 정리 5 파일 (`seed-admin` / `seed-all` / `seed-themes` / `seed-more-classics` / `db-sync`) — `tsc` 무에러 정합 (발견 사항 #1 박제).

---

## 3. 보안 / 작가 콘텐츠 / 시각 정본 / 원가

- **작가 콘텐츠** — 본 qa는 마이그레이션 + grep + SQL + spec 수행만, 작가 본문 미접촉. ACCOUNTS.md 미참조.
- **시각 정본** — UI 변경 0건 (案 P3-Y 옵션 A 응답 키 보존, web 영향 0). visual-canon-keeper 게이트 **불요**.
- **§0 원가** — 신규 AI 호출 0건. cost-accountant 게이트 **불요**.
- **보안** — auth.controller 5 핸들러 `@Throttle` 보존, JwtAuthGuard 보존 (profile/change-password). Optional DI 안전망 정합.

## 4. 발견 사항 (qa 측 추가)

1. **`auth.controller.spec` 부재 확인** — application layer `auth.usecase.spec`만 존재(hexagonal 정합). `resolveCredits` 안전망 폴백 분기는 controller-level spec 부재 — 의도적 hexagonal 패턴(controller는 thin wrapper, 비즈니스 로직 spec은 usecase) + lazy 안전망(production app.module은 항상 주입)으로 정합. 향후 controller spec 신설 시 RED 게이트 강화 가능 (NICE-TO-HAVE, 본 qa 범위 외).
2. **RED 재현 spec 영역 확인** — `payment.usecase.spec` L428·L491·L509·L643·L673 5개 assert가 `credits` 키 보존 정합을 강제 검증 → 案 P3-Y-a 회귀 안전망 PASS.
3. **`RefundLog.credits` / `analyses.creditsCharged` 보존** — 다른 model의 `credits` 컬럼(환불 감사용 / 분석 차감 pt)은 Phase 2 박제 그대로 보존. `Author.credits` 단일 폐기 정합(混同 0건).
4. **schema.prisma 박제 주석 정합** — L23·24·53·153·154·256·257·466·479·524·537·538 12 박제 주석, 폐기·이행 정본 흔적 완전 박제 — 향후 audit trail PASS.

---

## 5. 게이트 종합 판정

### 5-1. CC-4 Phase 3 자체 게이트

| Gate | 결과 |
|---|---|
| 빌드 + tsc | **PASS** |
| jest 1054 + 커버리지 ≥60% | **PASS** |
| DROP 증명 grep + 파일 삭제 5건 | **PASS** |
| 로컬 dev DB 검증 SQL 5건 | **PASS** |
| 案 P3-Y 옵션 A (auth.controller credits 보존) | **PASS** |
| 案 P3-Y-a (webhook 응답 키 보존) | **PASS** |
| RED 재현 + 원복 청결 | **PASS** |
| 회귀 핵심 9 spec | **PASS** (145 tests) |
| shared-contracts §30 박제 | **PASS** |
| Prisma migrate status "up to date" | **PASS** |

### 5-2. CC-4 sprint 전체 종결

- **Phase 1 + Phase 2 + Phase 3 = 종결** (Phase 2는 prod rev 104 + 본 Phase 3는 dev 로컬 apply 완료, prod migration apply는 grimoire-infrastructure 영역 별도 핸드오프).
- **§2-3 폐기 의존 그래프** = 종결 (`CreditRepositoryPort` 인터페이스 자체 제거 + 파일 4건 삭제 + DI provider 제거).
- **적립 8경로 (T1~T8) 신 CreditLedger 정합** = 종결.

### 5-3. 배포 게이트

- **develop → prod** (CC-4 Phase 3 코드 + 마이그레이션 1건): **PASS — 진행 가능**
  - 조건: ① pg_dump 백업 의무 (prod `pg_dump --table=authors --table=credit_logs`) ② 사용자 키워드 게이트 사전 통과 박제 (5/21) 정합 ③ grimoire-infrastructure 측 prod migration apply 핸드오프 ④ web 측 `data-model.md` + `api-contract.md` docs sync (코드 변경 0건).
  - 비가역 SQL — 롤백은 pg_dump 복원만 가능 (단일 통과 게이트).

### 5-4. 종합

**CC-4 Phase 3 AUDIT — PASS** (10/10 검증 영역 PASS, RED 재현 1건 + 원복 청결, 회귀 0건).
**CC-4 sprint 전체 종결 — PASS** (크레딧 디노미네이션 + 4 출처 회계 시스템 단일 정본 종결).

---

## 6. 핸드오프

- **grimoire-infrastructure** — prod `20260521_author_credits_drop_credit_log_phase3` 마이그레이션 apply (pg_dump 백업 의무, 비가역 게이트).
- **grimoire-web** — `data-model.md` + `api-contract.md` docs sync only (코드 변경 0건, 案 P3-Y 옵션 A 보존 — `AuthUser.credits` web 영향 0).
- **사용자** — CC-4 sprint 전체 종결. 다음 1순위 = PAY-S1 + CC-5 (Polar 구독 연동) 또는 HIGH-1 案 B 별도 sprint (5/21 결정 박제).
- **별도 sprint**: Phase 4 응답 일관성 정합 (`processNormalizedWebhook` 반환 키 `{credits, deficitCredits}` → `{points, deficitPoints}`, 외부 호환성 영향 평가 종속).

---

**산출물 박제**: `reports/QA_REPORT.md` (본 문서) — CC-4 Phase 3 AUDIT + CC-4 sprint 전체 종결 게이트 PASS.
