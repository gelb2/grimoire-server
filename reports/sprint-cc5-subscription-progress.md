# CC-5 sprint 진행 — PAY-P1-4 Polar 구독 정기결제 + HIGH-1 案 B

> 정본 계획: `.claude/state/sprint-cc5-subscription-plan-draft.md` (38 sub-task)
> 진단 근거: `reports/CREDIT_CORE_DIAGNOSIS.md` §7(PAY-P1-4) + §5-A(HIGH-1)
> 브랜치: `feature/cc5-subscription-polar` → develop `--no-ff` 로컬 머지 (remote push 금지)
> 범위: 코드 구현만. Polar 구독 상품 실등록 / 배포 / priceUsd cost-accountant 게이트 = 범위 외

---

## S0 — 선행 미확인 7건 현행 해소 (착수 게이트)

| # | sub-task | 결과 |
|---|---|---|
| C1a | webhook 화이트리스트 현행 | ✅ `polar.adapter.ts:293` `switch` — `order.paid`/`order.updated`/`order.refunded`/`checkout.updated` + `default: return null` (구독 무시) |
| C1b | `NormalizedWebhookEvent` 시그니처 | ✅ `status: 'success'\|'fail'\|'cancel'` 3값 — 구독 생명주기(created/updated/canceled/revoked) 부적합 → §5 신 필드 설계 |
| C1c | `MembershipPlanPort` 5 메서드 | ✅ `getPlan`/`resetMonthlyPool`/`findPlansToReset`/`changeTier`/`checkAndResetExpiredPool` + `MembershipPlanState`(polarSubscriptionId 포함) |
| C1d | `changeTier` 案 A 동기 | ✅ `prisma-membership-plan.repository.ts:158` `tx.author.update({ plan, planExpireAt })` 案 A 동기 중. `polarSubscriptionId` 미수신 → §6 매핑 저장 추가 |
| C1e | `Author.plan` 읽기 전수 | ✅ application 직접 읽기 = generate-theme(2) + theme-slot(5) + get-theme(4) + plan.usecase(5) + admin.usecase(3 — author_create/changePlan) = **19곳**(isPlanExpired/DAILY_FREE/THEME_SLOT/updatePlan). adapter = prisma-membership-plan(案 A 동기) + prisma-author(repository) |
| C1f | `polarSubscriptionId` + 멱등성 게이트 | ✅ `schema.prisma:596` `polarSubscriptionId String? @unique`. `payment.usecase.ts:276` `webhookEventRepo.findByEventId` 멱등성 게이트 — 구독 webhook 재사용 가능 |
| C1g | 멤버십 가격 정본 | ✅ `MEMBERSHIP_PRICE_KRW` Pro ₩9,900 / Premium ₩19,900 §0 PASS. priceUsd 정본 미존재 — 본 작업 범위 외(cost-accountant 게이트 별도) |

**S0 게이트 — PASS**. Phase A 진입 허가.

---

## Phase A — HIGH-1 案 B (`MembershipPlan.tier` 정본화) — 완료

| # | sub-task | 결과 |
|---|---|---|
| C2a | ADR-014 案 A→案 B 전환 명문화 | ✅ port doc comment + schema 주석에 案 B 박제. ADR.md 갱신 = C8d |
| C2b | `resolveTierOrFree` 도메인 헬퍼 | ✅ `membership-tier.ts` — plan null/non-active → 'free' 폴백. `isMembershipExpired`(plan.ts) — status 기반 만기 |
| C2c | `resolveTierOrFree` 단위 spec | ✅ `membership-tier.spec.ts` +6 it |
| C2d | theme 도메인 이행 | ✅ generate-theme(2)/theme-slot(5)/get-theme(4) — `MembershipPlanPort.getPlan` + `resolveTierOrFree`/`isMembershipExpired`. `MEMBERSHIP_THEME_SLOTS`/`MEMBERSHIP_DAILY_FREE_THEME` 사용. `MembershipPlanPort` Optional DI |
| C2e | `plan.usecase` 이행 | ✅ getPlanInfo → getPlan / activatePlan → changeTier(직접 updatePlan 0건) / handleExpiry → getPlan 만기 |
| C2f | admin 경로 이행 | ✅ createAuthor/changePlan → changeTier. AdminAuditLog 박제 유지(before tier/status) |
| C2g | `Author.plan`/`planExpireAt` `[DEPRECATED]` 박제 | ✅ schema.prisma 주석. `changeTier` 案 A 미러 유지(DROP 전까지). 컬럼 물리 DROP = 별도 후속 |
| C2h | 영향 spec 일괄 갱신 | ✅ generate-theme/theme-slot/plan/admin spec — `MembershipPlanPort` mock 보강. `prisma-membership-plan.repository.spec` +5 it(polarSubscriptionId/status) |
| C2i | Phase A 통합 검증 | ✅ Phase C 통합 spec C7g 케이스 ④에 흡수(구독 webhook 후 theme-slot 새 tier 반영) |

**Phase A 게이트 — PASS**. `Author.plan` application 직접 읽기 0건(getPlan 경유), deprecated 박제 완료.

## Phase B — Polar 구독 webhook

(작업 중 갱신)

## Phase C — HTTP 엔드포인트 + 통합

(작업 중 갱신)

## 마무리

(작업 중 갱신)
