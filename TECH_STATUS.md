# TECH_STATUS.md — grimoire-server

> 현재 구현 상태 + 배포 현황.
> 이 문서는 Level 2 정본이다. 코드 변경 시 이 문서를 업데이트한다.

---

## 1. 현재 버전

최신 버전은 `CHANGELOG.md` 참조.

---

## 2. 구현 상태

### API 엔드포인트

전체 엔드포인트 명세: `docs/api-contract.md` 참조.
엔드포인트 수: `docs/api-contract.md` 참조 (하드코딩 금지 — 문서 피라미드 규칙)

| 카테고리 | 상태 |
|----------|------|
| Health | 구현 완료 |
| Auth (이메일 + Google OAuth + 비밀번호 변경) | 구현 완료 |
| Theme (생성/조회/퍼블리시/CSS/프리셋/슬롯/활성화/작품배정) | 구현 완료 |
| Manuscript (파싱 + 파일 업로드) | 구현 완료 |
| Work Management (작품/에피소드 CRUD + 재업로드) | 구현 완료 |
| Author (공개 조회) | 구현 완료 |
| Content (공개 조회) | 구현 완료 |
| Social (좋아요/구독/댓글) | 구현 완료 |
| Reader (북마크/읽기 진행도) | 구현 완료 |
| Discovery (검색/인기/최신 + 페이지네이션) | 구현 완료 |
| Payment (Polar — 상품/웹훅/크레딧) | 구현 완료 |
| Payment 웹훅 멱등성 (event_id @unique, PAY-P0-1) | 구현 완료 (2026-05-03) |
| Payment PG↔DB 정합성 검증 cron (PAY-P0-2, 10분 주기) | 구현 완료 (2026-05-03) |
| Payment 환불 정밀 처리 (PAY-P1-1, RefundLog + 크레딧 환수 트랜잭션 + deficit 분기) | 구현 완료 (2026-05-03) |
| Admin (통계/사용자/콘텐츠/제재/신고/댓글/결제/접근로그/설정/감사로그 — 개수는 `docs/api-contract.md` 참조) | 구현 완료 |
| Analysis (RAG 인덱싱/일관성 체크) | 구현 완료 |
| Chat (AI 어시스턴트 — 세션/메시지/RAG) | 구현 완료 |
| Chat 4구간 사후 차감 (크레딧 개편 I Phase, ADR-012) | 코드 구현 완료 (2026-05-17) — dev/prod migration apply 대기 (§7 키워드 게이트) |
| 크레딧 디노미네이션 1:1,000 + 포인트 출처 4종 분리 회계 (CreditLedger 원장, ADR-012) | 코드 구현 완료 (2026-05-17) — dev/prod migration apply 대기 |
| 구독 월 포인트 풀 (MembershipPlan, 이월 금지, ADR-012) | 코드 구현 완료 (2026-05-17) — dev/prod migration apply 대기 |
| 크레딧 적립 비결제 연동 (CC-1 — 가입/첫작품/관리자지급·차감/테마차감) | 구현 완료 (2026-05-19) — CRITICAL-2 해소 |
| 크레딧 충전 결제 적립 연동 (CC-2a — T3 충전 + 디노미 4종 + C-6 해소) | 구현 완료 (2026-05-20) — CRITICAL-2 충전분 해소 |
| 크레딧 선물·환불 결제 적립 연동 (CC-2b — T4 선물 + T7 환불 + 이중 외상 통합) | 구현 완료 (2026-05-20) — **CRITICAL-2 완전 종결** (적립 8경로 신 시스템 이행) |
| 이월 금지 lazy 안전망 + Author.plan 양측 동기 + 신 ledger 선물 랭킹 (CC-3 — ADR-014) | 구현 완료 (2026-05-20) — **잔존 결함 3건 종결** (CRITICAL-1·HIGH-1·HIGH-3) |
| 크레딧 폐기 정리 Phase 1 (CC-4 P1 — 구 메서드 제거 + admin·discovery 신·구 분열 해소) | 구현 완료 (2026-05-21) — 마이그레이션 0건 / Phase 2 + Phase 3 = 별도 sprint |
| 크레딧 폐기 정리 Phase 2 (CC-4 P2 — `Payment.credits → Payment.points` 물리 rename + RefundLog 案 Y 보존) | 구현 완료 (2026-05-21) — 마이그레이션 1건(`20260521_payment_credits_rename_phase2`, 로컬 dev DB apply PASS) / Phase 3 (`Author.credits` DROP + `CreditLog` 폐기) = 별도 sprint |
| 크레딧 폐기 정리 Phase 3 (CC-4 P3 — `Author.credits` DROP + `CreditLog` 폐기 + `CreditRepositoryPort` 파일/Port 자체 제거 + 案 P3-Y 옵션 A 응답 키 보존) | 구현 완료 (2026-05-21) — 마이그레이션 1건(`20260521_author_credits_drop_credit_log_phase3`, 로컬 dev DB apply PASS) / dev·prod migration apply = grimoire-infrastructure 핸드오프 / **CC-4 sprint 전체 종결** |
| Plan (구독 플랜 + 테마 슬롯 관리) | 구현 완료 |

> **크레딧 개편 I Phase (2026-05-17)**: `sprint-credit-overhaul` — 디노미네이션 1:1,000 + 포인트 출처 4종 분리 회계 + 채팅 4구간 사후 차감 코드 구현 완료. schema.prisma 변경 + migration 파일 작성. **로컬 DB는 PAY-S1(2026-05-19)으로 apply 완료**, dev/prod는 §7 단계6/9 사용자 키워드 게이트(`크레딧개편 dev migration 진행` / `크레딧개편 prod migration 진행`) 대기. 정본: ADR-012 + `research/CREDIT_PRICING_OVERHAUL_PLAN.md` §8.
>
> **크레딧 개편 CC-1 (2026-05-19)**: 적립 비결제 연동 — I Phase 의 CRITICAL-2(`GrantPointsUseCase` 5메서드 호출처 0건 / `chargeTheme` 미연동) 해소. 비결제 적립 5경로(가입 보너스 / 첫 작품 보너스 / 관리자 수동 지급·차감 / 테마 차감)를 신 `CreditLedger` 원장으로 이행. `auth`/`work-management`/`admin`/`generate-theme` usecase 가 `GrantPointsUseCase`·`ChargePointsUseCase` 를 실제 호출하도록 재배선 + 통합 테스트(`credit-grant-integration.spec.ts`) 신설. 잔여: T3 충전 / T4 선물 / T7 환불 적립 = CC-2 범위. 정본: `reports/CREDIT_CORE_DIAGNOSIS.md` §8.
>
> **크레딧 개편 CC-2a (2026-05-20)**: 충전 결제 적립 연동 — CC-1 의 잔여 중 T3 충전 해소. `PaymentRepositoryPort.completePaymentWithPoints` 신설 (案 1 — 단일 `$transaction` 으로 Payment 완료 + deficit 우선 상계 + 충전 `CreditLedger` charged earn + `Author` 캐시. 헥사고날 DIP 보존). `payment.usecase` 충전 success 분기를 구 `completePaymentAtomically` → `completePaymentWithPoints` 재배선 — `settleDeficit` 가 실 충전 경로에 처음 연결돼 **C-6 해소** (deficit 상한 작가가 충전하면 외상 상계 → 채팅 차단 해제). `CREDIT_PRODUCTS` 디노미 4종 개편(입문/기본/인기/베스트, `points` Int=총 pt + `bonusRate`). 도메인 헬퍼 `computeChargeLedgerEntries` 추출. 통합 spec `payment-charge-credit-integration.spec.ts` 신설 (충전 webhook → CreditLedger 사슬 검증, RED 재현 실증). 잔여: T4 선물 / T7 환불 적립 = CC-2b 범위. 정본: `reports/CREDIT_CORE_DIAGNOSIS.md` §1-A·§6·§8.
>
> **크레딧 개편 CC-2b (2026-05-20)**: 선물·환불 결제 적립 연동 — **CRITICAL-2 완전 종결** (적립 8경로 中 마지막 T4 선물 + T7 환불 신 시스템 이행). `CreditLedgerPort.transfer` 신설 (案 G1 — 단일 `$transaction`: 데드락 방지 lock 순서 작은 id 먼저 FOR UPDATE + sender `planConsumption` 4 출처 차감(deficit 금지) + receiver `gift` earn). `credit.usecase.gift` 재배선 — body `amount` 단위 = **pt** (1,000/3,000/5,000pt 3단계, `GIFT_POINT_OPTIONS` 도메인 상수, 메인 §6 결정). `PaymentRepositoryPort.refundPaymentWithPoints` 신설 (案 R1 — 案 1 대칭): 비례 계산(PAY-P2-1) + `computeRefundLedgerEntries`(charged→gift→subscription→free 우선) + `$executeRawUnsafe` CAS race 차단(PAY-P3-A) + **이중 외상 통합**(부족분 `Author.deficitPoints` 가산 → CC-2a `completePaymentWithPoints` 가 다음 충전 시 자동 회수). `RefundLog.credits`/`deficitCredits` 의미 재해석(pt 단위 + 외상 기여분 — 물리 rename 0건, CC-4 위임). 통합 spec `credit-gift-refund-integration.spec.ts` 신설 (C7b 선물 양측 + C7c 4 출처 환수 + **C7d 이중 외상 통합** RED 재현 실증). jest 1042 PASS / 커버리지 61.11%. **CRITICAL-2 종결 증명**: 적립 8경로(T1~T8) 전부 신 `CreditLedger` — `ledger.transfer` + `refundPaymentWithPoints` application 호출 각 ≥1건, 구 `giftTransfer`·`refundPaymentAtomically` application 호출 0건. **CC-3 후속 필수**: `getGiftRanking`/`getLogs` (구 `CreditLog` 집계) → `CreditLedger` 재작성. 정본: `reports/CREDIT_CORE_DIAGNOSIS.md` §1-B·§1-C·§8.
>
> **크레딧 개편 CC-4 Phase 2 (2026-05-21)**: `Payment.credits → Payment.points` 물리 rename + RefundLog 案 Y 보존. ① Prisma schema + 마이그레이션 `20260521_payment_credits_rename_phase2` (1건, `ALTER TABLE "payments" RENAME COLUMN "credits" TO "points"` — Postgres native, 메타데이터 한정 락, 무손실, 즉시. 역방향 ALTER로 비파괴 롤백). ② `PaymentRepositoryPort.PaymentRecord.credits → points` + `create()` 입력 `credits→points` 정합. ③ 코드 일괄 rename ~30곳 + spec 7 파일 — `payment.usecase.ts` / `payment-reconciliation.job.ts` / `prisma-payment.repository.ts` / `refund-payment.usecase.ts` / `domain/model/config.ts` / `payment.usecase.spec.ts` / `payment-charge-credit-integration.spec.ts` / `credit-gift-refund-integration.spec.ts` / `payment-reconciliation.job.spec.ts` / `payment-cleanup.job.spec.ts` / `webhook-retry.job.spec.ts` / `prisma-payment.repository.spec.ts`. ④ **RefundLog 案 Y 보존**: `RefundLog.credits` + `RefundLog.deficitCredits` 컬럼 DDL 변경 0건. 의미 박제 강화(schema.prisma:535-542 주석 + shared-contracts §13/§30 박제). 보존 사유 = (a) 명명 충돌 회피(Author.deficitPoints) (b) 회귀 범위 최소화(admin/audit 전용, HTTP 미노출). ⑤ **응답 키 보존**: `processNormalizedWebhook` 반환 `{ processed, credits, deficitCredits? }` 외부 호환성(webhook payload) 유지. ⑥ HTTP 응답 영향 0건 — `GET /payments/products` 응답 키 이미 CC-2a 박제(`points`/`pricePerPoint`) / `GET /payments/credits` CC-3 박제(`bySource.charged`). jest 1063→1063 PASS(변동 0 — assertion 키만 변경, 신설 it 0) / 커버리지 61.74%(stmts) / 63.33%(lines) — 게이트 ≥60% 충족. 빌드 + tsc PASS. **로컬 dev DB migration apply PASS** — 사후 검증 SQL 4건 PASS(`payments.points` 컬럼 존재 + 구 `credits` 컬럼 0건 / row count 0/0 일치 / `refund_logs.credits`+`deficit_credits` 보존 / `prisma migrate status` up-to-date). cost-accountant/visual-canon-keeper 게이트 불요(신규 AI 0건, UI 영향 0건). **Payment.points 정합 종결 증명**: `grep "payment\.credits\|Payment\.credits" src --exclude="*.spec.ts"` = 주석 매치 2건만(rename 박제 이력) — 코드 본문 호출 0건. Phase 3 이월 = `Author.credits` DROP + `CreditLog` 폐기 + `prisma-credit.repository` 잔존 메서드 제거 + `auth.controller:48`/`refund-payment.usecase:124-125`/`credit-migration.ts` 정리. ≥1 sprint 운영 박제 후 별도 sprint. HIGH-1 案 B = Case C 별도 sprint(사용자 결정 5/21). 정본: `.claude/state/sprint-cc4-phase2-rename-plan-draft.md` + `reports/sprint-cc4-phase2-rename-progress.md`.
>
> **크레딧 개편 CC-4 Phase 1 (2026-05-21)**: 폐기 정리 — 구 메서드 제거 + admin·discovery 신·구 분열 해소. ① 구 메서드 시그니처 + 본문 완전 제거 — `CreditUseCase.grant`/`.deduct`/`.getBalance` + `CreditRepositoryPort.adjustCredits`/`giftTransfer`/`sumNegativeAmounts` + `PaymentRepositoryPort.completePaymentAtomically`/`refundPaymentAtomically` (잔존 = `CreditRepositoryPort.findLogsByAuthorId`/`getGiftRanking` 2종 폴백 — Phase 3 폐기). ② **신·구 분열 해소** — `CreditLedgerPort.sumSpendByAuthor(authorId?)` 신설(절대값 반환) + `admin.usecase.getStats`/`getAllCreditLogs` 신 ledger 위임 + `discovery.usecase.getMostGiftedAuthors` → `CreditUseCase.getGiftRanking` 위임 (CC-3 ledger 위임 재사용 → CC-2b 신 선물 인식). ③ `AdminUseCase`/`SocialUseCase`/`DiscoveryUseCase`/`NovelAnalysisUseCase` 생성자에서 `creditRepo` DI 제거(신 시스템 단일 경로). `CreditReason` enum 폐기(`CreditLedger.reason` 자유 문자열). ④ 통합 spec `CC-4 Phase 1 통합 — 구 메서드 제거 + admin·discovery 신·구 분열 해소` describe 신설(4 it). jest 1059→1063 PASS / 커버리지 61.74%/63.33%(lines) — 게이트 ≥60% 충족. 마이그레이션 0건 — Phase 2(`Payment.credits`→`Payment.points` rename) / Phase 3(`Author.credits` DROP + `CreditLog` 폐기) = 운영 안정성 ≥1 sprint 박제 후 별도 sprint(Cursor 반면교사). 정본: `.claude/state/sprint-cc4-postcleanup-plan-draft.md` 옵션 Z.
>
> **크레딧 개편 CC-4 Phase 3 (2026-05-21)**: `Author.credits` DROP + `CreditLog` 폐기 — **CC-4 sprint 전체 종결 단계**. ① **비가역 마이그레이션 1건**: `20260521_author_credits_drop_credit_log_phase3` — `ALTER TABLE "authors" DROP COLUMN "credits"` + `DROP TABLE IF EXISTS "credit_logs" CASCADE`. 사용자 키워드 게이트 사전 통과(5/21 박제: "Author.credits DROP + CreditLog 폐기 prod migration 진행"). pg_dump 백업 필수. ② **잔존 코드 제거**: `auth.controller.ts:48` 응답 직렬화 `credits: author.credits` → 案 P3-Y 옵션 A 적용 — 응답 키 `credits` **보존**(web `AuthUser.credits`/`PlatformNav.tsx`/admin authors 영향 회피), 값 = `creditLedger.getBalance(author.id).total` 매핑(ledger 미주입/throw 시 0 폴백 안전망). `AuthController` 생성자 `CreditLedgerPort` Optional DI + `resolveCredits` 헬퍼 + 5 핸들러(register/login/google/refresh/profile) 매핑. `refund-payment.usecase.ts:115-136` `authorRepo` 폴백(author.credits ?? 0) 완전 제거 → ledger 단일 경로 + 생성자 `authorRepo` 인자 제거. `prisma-author.repository.ts` `updateCredits` 메서드 + 매핑 전부 제거. `Author` 도메인 model `credits` 필드 제거. `AuthorRepositoryPort.updateCredits` 시그니처 제거. ③ **파일/Port 삭제 4건**: `prisma-credit.repository.ts` + `credit-repository.port.ts` + `domain/model/credit.ts`(CreditLog interface) + `domain/model/credit-migration.ts`(+spec — V Phase 마이그레이션 후 1회 사용 도구, 案 P3-d-X). `domain/model/index.ts` re-export 제거. ④ **DI/usecase 정리**: `app.module.ts` `CreditRepositoryPort` provider 제거. `CreditUseCase` 생성자 3 인자 → 2 인자(`authorRepo`, `ledger?`, `membershipRepo?`). `getGiftRanking`/`getLogs` ledger 미주입 폴백 분기 제거 + ledger Required (미주입 시 BadRequest). `getLogs` 반환 `CreditLedgerEntry[]` 단일. ⑤ **Prisma schema 갱신**: `Author.credits Int` + `Author.creditLogs CreditLog[]` + `model CreditLog` 전체 제거. ⑥ **scripts/ 정리**: `seed-*`/`db-sync.ts` `credits` 필드 + `creditLog` 호출 제거. ⑦ **응답 키 案 P3-Y-a 보존**: `processNormalizedWebhook` 반환 `{ processed, credits, deficitCredits? }` Phase 2 박제 그대로 유지. 응답 일관성 정합은 Phase 4/CC-5 별도 sprint. ⑧ **spec 정리**: `credit.usecase.spec.ts` `mockCreditRepo` 제거 + ledger 미주입 폴백 → BadRequest. `refund-payment.usecase.spec.ts` `mockAuthorRepo`/4번째 인자/`fallback` spec 제거. 통합 spec 2 파일 `makeCreditRepoMock` 헬퍼 + 첫 인자 제거. `prisma-fk-cascade.spec.ts` Restrict 8건 → 7건 정합(CreditLog 제거). **신설 통합 describe**: `credit-rollover-source-ledger-integration.spec.ts` `CC-4 Phase 3 — Author.credits 컬럼 + CreditLog 테이블 폐기 정합` (3 it). jest 1051→1054 PASS / 커버리지 61.66%(stmts) / 63.23%(lines) — 게이트 ≥60% 충족. 빌드 + tsc PASS. **로컬 dev DB migration apply PASS** — 사후 검증 SQL 4건 + Phase 2 정합 회귀 1건 = 5건 PASS(`authors.credits` 컬럼 부재 / `credit_logs` 테이블 부재 / 신 4 출처+deficit 5컬럼 정합 / migration finished_at NOT NULL / Phase 2 `payments.points` 회귀 0건). cost-accountant/visual-canon-keeper 게이트 불요(신규 AI 0건, UI 변경 0건 — 案 P3-Y 옵션 A 보존). **DROP 증명**: `grep "\.credits\b" src --exclude="*.spec.ts" | grep -v "//\|/\*"` = 코드 본문 0건(주석/박제만) / 4 파일 삭제 확인. **CC-4 sprint 전체 종결 박제**: Phase 1(구 메서드 제거) + Phase 2(`Payment.credits→points` rename) + Phase 3(`Author.credits` DROP + `CreditLog` 폐기) = 크레딧 디노미네이션 + 4 출처 회계 시스템 단일 정본 종결. dev/prod migration apply는 grimoire-infrastructure 영역(별도 핸드오프). web 핸드오프 = data-model.md + api-contract.md sync only(코드 변경 0건). HIGH-1 案 B = Case C 별도 sprint(사용자 결정 5/21) + CC-5 PAY-P1-4 Polar 구독 연동(별도 sprint) + Phase 4 응답 일관성 정합(별도 sprint, 외부 호환성 영향 평가 종속). 정본: `.claude/state/sprint-cc4-phase3-drop-plan-draft.md` + `reports/sprint-cc4-phase3-drop-progress.md`.
>
> **크레딧 개편 CC-3 (2026-05-20)**: 이월 금지 lazy 안전망 + Author.plan 양측 동기 + 신 ledger 선물 랭킹 — **잔존 결함 3건(CRITICAL-1·HIGH-1·HIGH-3) 종결**. ① **CRITICAL-1 案 B** — `MembershipPlanPort.checkAndResetExpiredPool(authorId, now)` 신설(port 추상화). `credit.usecase.getPointBalance` 진입에 lazy 훅 (Optional DI, BACKWARD COMPATIBLE) — 호출 조건 `poolResetAt <= now AND tier !== 'free' AND status === 'active'` (free/미만료/non-active no-op). cron(`ResetMonthlyPoolJob`) 1차 + lazy 2차 이중 안전망. cron 실패해도 잔액 조회 시점에 자동 보정 → §8-8 #2 "이월 금지" 코드 강제. S Phase draft §8-6 원안 복원(`reset-monthly-pool.job.ts:18` "I Phase 후속" 후속). ② **HIGH-1 案 A** — `MembershipPlanPort.changeTier` 트랜잭션에 `Author.plan` + `planExpireAt` 동기 갱신. `Author.plan` 정본 유지 + `MembershipPlan.tier` 미러. 案 B(`tier` 정본화 + 읽기 13곳 이행)는 CC-3 비대 회피로 미채택(CC-5/후속 옵션 보존). `changeTier` 호출처 현재 0건이라 案 A 위험 ZERO. ③ **HIGH-3** — `CreditLedgerPort.getGiftRanking` 신설(`creditLedger.groupBy source='gift', type='earn'`). `credit.usecase.getGiftRanking`/`getLogs` → ledger 위임 (ledger null 시 구 경로 폴백). **인터페이스 변경**: `MembershipPlanPort.checkAndResetExpiredPool` + `LazyResetResult` + `CreditLedgerPort.getGiftRanking` / `GET /credits/logs` 응답 = `CreditLedgerEntry[]` (source/type/balanceAfter/expiresAt/relatedId 추가). 통합 spec `credit-rollover-source-ledger-integration.spec.ts` (I1b cron 미실행 lazy 자동 보정 4 시나리오 + I1c `changeTier` 양측 동기 + CC-2b 신 선물 ranking 집계 + `getLogs` `CreditLedgerEntry[]` 반환). jest 1073 PASS / 커버리지 61.61%(stmts) / 63.21%(lines). **결함 3건 종결 증명**: ① `grep checkAndResetExpiredPool src` ≥4건 + 통합 I1b PASS ② `changeTier` 본문 `data: { plan: tier, planExpireAt }` 박제 + I1c PASS ③ `credit.usecase` 구 `creditRepo.getGiftRanking`/`findLogsByAuthorId` 호출 = ledger null 폴백 경로만 + `ledger.getGiftRanking` 호출처 ≥1건 + I1c PASS. **CC-4 후속 잔존**: `admin.usecase.findLogsByAuthorId` + `discovery.usecase.getMostGiftedAuthors` 도 같은 신·구 분열 영향 (별도 정합 sprint) / 案 B 이행 / `MembershipPlanPort.getPlan` HTTP / `CreditLog` 폐기 / `Author.credits` DROP / V Phase 마이그레이션 / sensor 7종 hook 등록(harness). 정본: `reports/CREDIT_CORE_DIAGNOSIS.md` §4·§5-A·§5-B·§8 + ADR-014.

### 보안 인프라

| 항목 | 상태 |
|------|------|
| 데드락 방지 (SELECT FOR UPDATE) | 구현 완료 |
| 보안 접근 로그 (access_logs) | 구현 완료 |
| 관리자 감사 로그 (admin_audit_logs) | 구현 완료 |
| 사용자 제재 시스템 (user_sanctions) | 구현 완료 |
| 콘텐츠 신고 시스템 (reports) | 구현 완료 |
| 로그인 시 제재 확인 + 차단 | 구현 완료 |
| 시스템 설정 (system_settings) | 구현 완료 |

### 원고 파서 지원 포맷

| 포맷 | 파서 | 상태 |
|------|------|------|
| Markdown (.md) | md-parser.ts | 구현 완료 |
| 텍스트 (.txt) | txt-parser.ts | 구현 완료 |
| Word (.docx) | docx-parser.ts (mammoth) | 구현 완료 |
| 한글 (.hwp) | hwp-parser.ts | 구현 완료 |
| 한글 (.hwpx) | hwp-parser.ts | 구현 완료 |
| HTML (.html) | 미구현 (최후순위) | - |

### Prisma 스키마

- 정본: `prisma/schema.prisma`
- 모델 수: `grep -c '^model ' prisma/schema.prisma` 로 확인 (하드코딩 금지)
- 설명: `SCHEMA.md`, `docs/data-model.md`

### 테스트

- 테스트 수: `npm test` 실행으로 확인 (하드코딩 금지)
- 커버리지: `npx jest --coverage` 실행으로 확인 (목표 60%)

### 인프라

| 항목 | 상태 | 비고 |
|------|------|------|
| Docker | Dockerfile 작성 완료 | 멀티스테이지 빌드 + docker-entrypoint.sh |
| CI/CD | GitHub Actions 설정 완료 | `.github/workflows/` 확인 |
| Azure Container Apps | 3환경 배포 완료 | 서버 호스팅 |
| Azure Database for PostgreSQL | 3환경 설정 완료 | DB |
| Azure Container Registry | 설정 완료 | Docker 이미지 |
| Azure Blob Storage | 설정 완료 | grimoire0storage (커버 + 테마 CSS) |
| Rate Limiting | 적용 완료 | NestJS Throttler 전면 적용 |
| 파일 업로드 | 적용 완료 | Multer (md/txt/docx/hwp/hwpx) |

상세: `INFRASTRUCTURE.md` 참조.

---

## 3. 배포 현황

| 환경 | 상태 | URL |
|------|------|-----|
| localhost | 로컬 개발 | localhost:3000 (Docker DB) |
| development | 배포 완료 | dev-api.grimoire-book.com |
| production | 배포 완료 | api.grimoire-book.com |

> 2026-04-19: inhouse 환경 제거 (3환경 → 2환경). QA는 dev에서 develop 브랜치로 수행.

---

## 4. 다음 단계

- Polar KYC + 한국 payout 승인 (사용자 액션)
- Redis 캐시 (테마 DB 호출 캐싱)
- AI 채팅 스트리밍 (SSE)
- HTML 파서 (최후순위)

### 최근 완료 (P1)
- **P1-#7 publishTheme bakedCssUrl 절대화 (2026-05-03)** — Blob 비활성/실패 시 NULL 박제 + 응답 시점 server 동적 절대화. 환경 전환 시 stale 박제 0건 보장. 마이그레이션 `20260503130451_baked_css_url_clear_relative` localhost 검증 완료. dev/prod는 사용자 명시 후 배포 — `MIGRATION.md` §7-Z 참조.

---

## 5. 참조 문서

- 루트 `SYNC_STATUS.md` — 서버-웹 연결 현황 + 갭 (정본)
- `docs/environments.md` — 빌드 환경 (정본)
- `docs/api-contract.md` — API 엔드포인트 명세 (정본)
- `TODO.md` — 남은 작업
- `TESTING.md` — 테스트 전략
- `INFRASTRUCTURE.md` — Azure 구성
