# Sprint PAY-S2 — 다중 부분환불 누적 한도 검증 (HIGH-1 해소)

> 2026-05-22 / grimoire-server / feature/pay-s2-refund-cap
> 결함 정본: `reports/PAYMENT_PIPELINE_DIAGNOSIS.md` §4 HIGH-1 (다중 부분환불 누적 한도 미검증)
> 인터페이스 정본: `.claude/shared-contracts.md` §17 PartialRefund / §22 PaymentRaceCondition

---

## 1. 결함 (HIGH-1)

`refundPaymentWithPoints` (`src/adapter/outbound/persistence/prisma-payment.repository.ts`)
의 validation 은 `refundedAmount > payment.amount` **단건 검사뿐**. 기존 `RefundLog`
누적 합산(`tx.refundLog.aggregate`/`_sum`) 0건.

- CC-2b 가 `refundPaymentAtomically` → `refundPaymentWithPoints` 재작성 시 누적 검증 미이식.
- `RefundLog` 는 `paymentId` 1:N (PAY-P2-1 다중 부분환불 호환 설계)이나 런타임 검증은 단건.
- **시나리오**: payment.amount=10,000 → 1차 부분환불 6,000 통과 → 2차 6,000 도
  `refundPaymentWithPoints` 자체로는 `6000 > 10000` false 라 통과 → 누적 12,000 적자.
- 현재 완화: webhook 경로는 `payment.usecase:332 isPaymentAlreadyRefunded` 가
  `status='partial_refunded'` 2회차를 차단해 미발현. 단 설계(1:N)와 런타임(1회 제한)
  불일치 + 게이트 우회 경로(reconciliation 수동 환수 / 향후 admin 다회 부분환불) 발현.

---

## 2. 구현 — 누적 한도 검증

### 위치

`refundPaymentWithPoints` `$transaction` 내부 — Payment 조회(`tx.payment.findUnique`)
+ authors row `FOR UPDATE` 잠금과 **같은 tx 핸들**. `payment.amount <= 0` 검사 직후,
Payment status update 전.

### 검증식

```typescript
const priorRefundAgg = await tx.refundLog.aggregate({
  where: { paymentId },
  _sum: { amount: true },
})
const priorRefundedAmount = priorRefundAgg._sum.amount ?? 0
if (priorRefundedAmount + refundedAmount > payment.amount) {
  throw new Error(`환불 누적 한도 초과 — ...`)
}
```

- `tx.refundLog.aggregate` 가 이 paymentId 에 이미 박제된 `RefundLog.amount` 누적 합산.
- `tx` 핸들 + authors `FOR UPDATE` 직렬화 → 동시 부분환불 race 0건 (§0 결제 원자성).
- `_sum.amount` 는 `RefundLog` 0건 시 Prisma 의미상 `null` → `?? 0` 폴백.

---

## 3. 정책 결정 — 案 A 채택

`isPaymentAlreadyRefunded`(`payment.usecase`) webhook 게이트 **현행 유지**.

- webhook 2회차(`partial_refunded`) 차단 + 회귀 0.
- 누적 검증은 **depth-in-defense** — repository 메서드 자체 방어선. 게이트 우회 경로
  (reconciliation 수동 환수 / 향후 admin 다회 부분환불)가 도입돼도 적자 물리적 불가.
- **이중 방어**: ① payment.usecase 사전 게이트(webhook) ② `refundPaymentWithPoints`
  `$transaction` 내부 누적 검증(webhook/manual/reconciliation 모든 경로).

### 案 변경 없음 — 근거

Polar webhook 동작 + reconciliation S2 경로(`payment-reconciliation.job.ts:241
handleRefundMismatch` — 현재 logger.warn + AuditLog 만, 실제 환수 0건) 검토 결과:
다중 부분환불 정식 지원(게이트 완화)은 Polar webhook 다중 부분환불 송신 동작 확인 +
reconciliation 정합이 선행돼야 함 → PAY-S2 범위 밖, PAY-P2 확장으로 이월.

---

## 4. 단건 검사 처리 — 흡수

구 단건 검사(`refundedAmount > payment.amount`)는 누적 검증으로 **흡수**(병행 제거).
기존 환불 누적이 0이면 `0 + refundedAmount > payment.amount` 로 단건 검사와 동치.
메시지만 `환불 누적 한도 초과` 어휘로 통합 — 의미는 누적 0 케이스에서도 정확.

기존 spec `refundedAmount > payment.amount 시 throw (validation)` it 의 기대 메시지를
흡수된 누적 검증 메시지로 갱신(누적 0 + 단건 초과 = 누적 검증식이 동일 throw).

---

## 5. spec — 누적 검증 단위 테스트

`prisma-payment.repository.spec.ts` `refundPaymentWithPoints` describe 에
`PAY-S2 — 누적 환불 한도 검증` describe 신설 (+3 it). payment.amount=10,000 시나리오:

- **① 누적 초과 throw**: 1차 부분환불 6,000 박제 후 2차 6,000 — 누적 12,000 > 10,000
  → `환불 누적 한도 초과` throw. `tx.refundLog.aggregate` WHERE/`_sum` 인자 정합 박제 +
  RefundLog 박제 0건 + CAS UPDATE 0건(트랜잭션 rollback 위임).
- **② 한도 내 통과 (案 A repository 직접 호출)**: 1차 6,000 후 2차 4,000 — 누적 10,000
  = 10,000 → 정상 환수 진행 (`isPartial=true`, RefundLog 박제).
- **③ 단건 초과 차단 (흡수 검증)**: 누적 0(`null`)에서 단건 12,000 > 10,000 → throw.

mock 보강: `txMock.refundLog.aggregate` (반환 `_sum.amount = priorRefundedSum`,
기본 0). 통합 spec `credit-gift-refund-integration.spec.ts` FakeRepo 에 paymentId 별
환불 누적(`refundedTotal` Map) 추적 + 누적 검증 정합 — 실 repository 와 동작 일치.

---

## 6. 완료 게이트

| 게이트 | 결과 |
|--------|------|
| `npm run build` | PASS (nest build 무에러) |
| `npm test` | 1097 passed / 1097 total (77 suites) — 이전 1094 → +3 it |
| 커버리지 | 61.94% stmts / 63.47% lines — 게이트 ≥60% 충족 |
| 마이그레이션 | 0건 (기존 `RefundLog` 테이블 재활용 — schema 변경 없음) |
| shared-contracts | §17 PartialRefund + §22 PaymentRaceCondition 갱신 |
| TECH_STATUS | PAY-S2 표 행 + narrative 블록 추가 |
| cost-accountant 게이트 | 불요 (신규 AI 기능 0건) |
| visual-canon-keeper 게이트 | 불요 (UI/테마 변경 0건) |

---

## 7. 발견 사항 + PAY-P2 이월

### 발견

- **진단 문서 작업트리 부재**: `reports/PAYMENT_PIPELINE_DIAGNOSIS.md` 가 git 추적·작업트리
  양쪽에서 누락(`git ls-files reports/` 3건만, `find` 캐시 오보고). 작업 지시서가 §4
  HIGH-1 핵심(L226/L277-281/L372 라인, 호출 체인 실측)을 정밀 명시 + 코드 직접 실측으로
  진행. 메인 후속 — 진단 문서 재박제 또는 본 progress 를 정본 대체로 승격 여부 결정 필요.
- **shared-contracts §17/§22 stale**: §17 시그니처가 구 `refundPaymentAtomically`
  (CC-2b 가 `refundPaymentWithPoints` 로 재작성), §22 CAS 가 구 `Author.credits` 단일
  컬럼(CC-4 Phase 3 DROP). PAY-S2 갱신 시 함께 정합 보정.

### PAY-P2 이월

- **다중 부분환불 정식 지원**: `isPaymentAlreadyRefunded` 완화로 `partial_refunded` 에
  추가 부분환불 허용. 선행 조건 — (a) Polar webhook 이 다중 부분환불 이벤트를 실제
  송신하는지 동작 확인 (b) reconciliation S2 경로(`handleRefundMismatch`)가 다회 부분
  환불 정합 처리하도록 확장 (현재 logger.warn + AuditLog 만, 실제 환수 0건).
- **`RefundLog` 멱등성**: 현재 `RefundLog` 에 UNIQUE 미부여 — 다중 부분환불 정식 지원 시
  webhook 재전송 멱등성(같은 환불 이벤트 2회 박제 방지) 보강 검토 필요.
