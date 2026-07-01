# 결제 데이터 처리 절차 깊이 전수검사 — 멱등성 / 검증 / 저장

> **작성일**: 2026-06-27
> **검사 방식**: 읽기 전용 코드 실측 (수정 0건). file:line 근거 기반. 추정 0건 — 모든 판정은 실제 코드 인용.
> **검사 범위**: `grimoire-server/src` 결제 도메인 전체 (멱등성·검증·저장 3축)
> **절대 규정**: CLAUDE.md §0 ZERO-TOLERANCE — "잘 됨" 단정 금지, 빈틈은 raw로 박제.

---

## 0. 검사 대상 인벤토리 (실측)

| 레이어 | 파일 | 역할 |
|--------|------|------|
| inbound | `src/adapter/inbound/http/controller/payment.controller.ts` | webhook/initiate/history 엔드포인트 |
| application | `src/application/payment/payment.usecase.ts` | webhook 처리 본체 (멱등성 게이트 + 분기) |
| application | `src/application/payment/refund-payment.usecase.ts` | 환불 usecase |
| application | `src/application/payment/payment-reconciliation.job.ts` | PG↔DB 정합 cron (PAY-P0-2) |
| application | `src/application/payment/webhook-retry.job.ts` | DLQ 재시도 cron (PAY-P2-2/P3-C) |
| application | `src/application/admin/audit-mask.job.ts` | audit retention 마스킹 cron (PAY-P2-5) |
| adapter(out) | `src/adapter/outbound/payment/polar.adapter.ts` | 서명 검증 + 정규화 + 금액 변환 |
| adapter(out) | `src/adapter/outbound/payment/polar-webhooks.ts` | Polar SDK `validateEvent` 래퍼 |
| adapter(out) | `src/adapter/outbound/persistence/prisma-payment.repository.ts` | 결제완료/환불 $transaction |
| adapter(out) | `src/adapter/outbound/persistence/prisma-webhook-event.repository.ts` | eventId 멱등성 박제 |
| adapter(out) | `src/adapter/outbound/persistence/prisma-webhook-retry-queue.repository.ts` | DLQ row CRUD |
| adapter(out) | `src/adapter/outbound/persistence/audit-mask-helper.ts` | PII 마스킹 순수 함수 |
| domain | `src/domain/model/payment-status.ts` | status enum + Polar 매핑 (PAY-P3-D) |
| schema | `prisma/schema.prisma` | Payment/WebhookEvent/WebhookRetryQueue/RefundLog/CreditLedger/AdminAuditLog |

**결제 spec 테스트 분포** (it() 카운트, `npm test` 미실행 — 정적 카운트):
```
40  payment.usecase.spec.ts
56  polar.adapter.spec.ts
25  prisma-payment.repository.spec.ts
14  webhook-retry.job.spec.ts
11  payment-charge-credit-integration.spec.ts
10  refund-payment.usecase.spec.ts
10  payment-notification.usecase.spec.ts
 9  payment-reconciliation.job.spec.ts
 9  prisma-webhook-event.repository.spec.ts
 8  process-subscription-webhook.usecase.spec.ts
 7  subscription-webhook-integration.spec.ts
 7  reset-monthly-pool.job.spec.ts
 6  payment-cleanup.job.spec.ts
```

**DI 배선 실측** (`src/app.module.ts`): PaymentUseCase의 모든 Optional 의존이 실 운영 module에 등록됨 → 침묵 실패(Optional 미주입으로 멱등성/감사 무력화) 위험 **낮음**.
- L171 PaymentUseCase / L172 PaymentReconciliationJob / L174 WebhookRetryJob / L175 RefundPaymentUseCase / L179 AuditLogService / L180 AuditMaskJob / L198 AuthorRepositoryPort / L223 WebhookEventRepositoryPort / L224 WebhookRetryQueueRepositoryPort / L225 ReconciliationCheckpointRepositoryPort / L214 CircuitBreakerPort / L215 PaymentGatewayPort=PolarAdapter

**raw body 파싱 실측** (`src/main.ts:45`): `app.use('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }))` → HMAC 서명 검증을 위한 raw Buffer 보존 정상.

---

## 축 1 — 멱등성 (Idempotency): **[부분]**

### 1-1. webhook eventId 중복 차단 (PAY-P0-1) — **[세밀히 구현]**

**다층 멱등성 박제 확인:**

- DB 제약: `prisma/schema.prisma:286` — `WebhookEvent.eventId String @unique @map("event_id")`. PG webhook 재전송 시 P2002 → safe skip의 물리적 토대.
- 1차 게이트 (애플리케이션): `payment.usecase.ts:306-310`
  ```ts
  const existing = await this.webhookEventRepo.findByEventId(event.eventId)
  if (existing && existing.status === 'processed') { ... return { reason: 'duplicate_event' } }
  ```
- 2차 게이트 (DB race): `prisma-webhook-event.repository.ts:27-47` — `createIfAbsent`가 P2002 catch → `null` 반환. 동시 진입 시 한쪽만 INSERT 성공.
- eventId 누락 안전 거부: `polar.adapter.ts:368-373` — `webhook-id` 헤더 누락 시 `null` 반환 ("멱등성 보장 불가 → 안전 거부"). 대소문자 fallback(`extractWebhookId`, L503-511).
- 테스트 입증: `payment.usecase.spec.ts:627-657` (동일 eventId 2회 → completePaymentWithPoints **1회만**), L659-675 (createIfAbsent P2002 race → 안전 처리).

**판정: 세밀히 구현.** eventId 유니크 + 애플리케이션 게이트 + DB race catch + 헤더 누락 거부의 4중 방어.

### 1-2. webhook event status='failed'/'skipped' 재처리 경로 — **[갭 — 의도된 설계지만 위험 잔존]**

`payment.usecase.ts:307`의 멱등성 게이트는 **`status === 'processed'`만 차단**한다. status가 `failed`/`skipped`로 박제된 eventId가 재수신되면 게이트를 **통과**한다.

- 이는 DLQ 재처리(failed → processed) 의도와 정합하나, 동일 eventId가 외부(Polar)로부터 직접 재전송될 때도 게이트를 통과해 `completePaymentWithPoints`가 **다시 실행 시도**된다.
- 2차 방어선: payment.status 선검사 — `payment.usecase.ts:325` (`COMPLETED`면 skip) + L341 (`isPaymentAlreadyRefunded`면 skip). 즉 첫 시도가 성공해 payment가 completed로 갔다면 재실행은 차단된다.
- **잔존 위험**: 첫 시도가 `completePaymentWithPoints` **트랜잭션 commit 직후 ~ webhookEvent 박제(L448) 사이**에서 실패했고(예: 박제 단계 DB 일시 장애), payment는 이미 completed인 경우 → 재수신 시 L325 게이트가 막아준다(OK). 그러나 첫 시도가 트랜잭션 **자체** 실패로 failed 박제된 경우(payment는 여전히 pending), 재수신 시 게이트 통과 + payment pending → 정상 재처리(의도대로 OK).
- 결론: 실질 이중 적립 위험은 payment.status 선검사가 흡수. 다만 **L307 게이트가 'processed' 단일 비교**라는 점은 멱등성의 1차 방어가 webhookEvent가 아닌 payment.status에 의존함을 의미 → 1-3 갭과 연동.

### 1-3. 결제 완료(success/충전) 경로 CAS race 차단 (PAY-P3-A) — **[갭 — 중대]**

**핵심 발견: 충전 적립(`completePaymentWithPoints`) 트랜잭션에는 Payment.status CAS가 없다.**

`prisma-payment.repository.ts:82-86`:
```ts
// ② Payment 완료 처리
await tx.payment.update({
  where: { id: paymentId },               // ← status WHERE 조건 없음
  data: { status: 'completed', completedAt: new Date() },
})
```

- 비교 — `expirePayment`만 유일하게 status CAS 적용: `prisma-payment.repository.ts:167-170` `updateMany({ where: { id, status: 'pending' } })`.
- "PAY-P3-A CAS race 차단" 주석이 가리키는 CAS는 **환불 경로의 출처 컬럼**(`authors.points_*`)에 대한 것(`prisma-payment.repository.ts:345-349` `UPDATE authors SET col = col - $1 WHERE id = $2 AND col >= $1`)이지, **Payment.status에 대한 CAS가 아니다.**
- success 경로의 멱등성은 오직: ① `webhookEvent.eventId @unique` ② 트랜잭션 진입 **전** payment.status 선검사(L325, application 레벨 TOCTOU) ③ `authors FOR UPDATE`(`prisma-payment.repository.ts:68-79`, 직렬화)에 의존.

**race window 시나리오 (실재 가능):**
1. Polar가 동일 결제에 대해 **서로 다른 webhook-id**로 2개 이벤트 발송 (order.paid + checkout.updated succeeded — `polar.adapter.ts:391,413`에서 둘 다 `success`로 정규화, tradeNo 동일).
2. eventId가 다르므로 L306 멱등성 게이트를 **둘 다 통과**.
3. 두 worker가 거의 동시에 `findByExternalTransactionId`(L312) → **둘 다 payment.status='pending'을 읽음** (TOCTOU).
4. `completePaymentWithPoints` 진입. `authors FOR UPDATE`가 직렬화는 하지만, 두 번째 트랜잭션도 **payment.status 재검증 없이** `tx.payment.update`로 completed 갱신 + `creditLedger.create` earn row **2개** 생성.
5. 결과: 1회 결제에 대해 **충전 적립 2배** (CreditLedger earn row 중복 + pointsCharged 캐시 2배 증가).

- 이는 단일 결제에 대한 **서로 다른 eventId 2건**일 때만 발생 (동일 eventId면 1-1 게이트가 막음). Polar는 order.paid와 checkout.updated를 별개 webhook-id로 보낼 수 있으므로 **이론적으로 열려 있다.**
- 테스트 한계: `payment.usecase.spec.ts:764-797` "AC-3 동시 환불 webhook 2건 race"는 `mockResolvedValueOnce`로 1차 pending → 2차 refunded를 **순차** 반환하는 시뮬이다(진짜 parallel 아님). 첫 트랜잭션이 commit된 **후** 진입하는 케이스만 검증하며, 두 worker가 **동시에 pending을 읽는** TOCTOU는 미검증.
- AC-6(`payment.usecase.spec.ts:799-824`)은 `completePaymentWithPoints`를 `mockRejectedValueOnce(Error('CAS_MISMATCH...'))`로 **에러 주입**해서 검증한다. 즉 코드가 CAS를 수행해서가 아니라 mock이 에러를 던지는 것 — success 경로에 실제 CAS_MISMATCH를 발생시키는 코드는 **없다**(grep `WHERE.*status` 결과 success 경로 0건).

**판정: 갭 (중대).** 환불 경로는 출처 컬럼 CAS로 2차 방어가 있으나, **충전 적립 경로는 Payment.status CAS가 전무**하여 "서로 다른 eventId · 동일 결제"의 동시 success webhook에서 이중 적립 가능. FOR UPDATE는 직렬화만 할 뿐 중복 실행 자체를 막지 못함.

### 1-4. 환불 3중 멱등성 (PAY-P1-1) — **[부분]**

`refund-payment.usecase.ts:22-25` 주석이 선언하는 "3중 게이트":
- **L1** webhook event_id (PAY-P0-1) — `payment.usecase.ts:306` 진입부. ✅
- **L2** payment.status='completed' 사전 체크 — `payment.usecase.ts:341` `isPaymentAlreadyRefunded`로 이미 환불된 payment는 cancel 분기 진입 전 차단. ✅
- **L3** RefundLog 박제 — `prisma-payment.repository.ts:396-405` (운영자 조회/추적용, 멱등성 자체 보장 X). ⚠️

**경계조건 1 — 부분환불 누적 (PAY-S2 / HIGH-1): [세밀히 구현]**
`prisma-payment.repository.ts:295-305` — 같은 `$transaction(tx)` 핸들로 `tx.refundLog.aggregate({ where: { paymentId }, _sum: { amount } })` 조회 후 `priorRefundedAmount + refundedAmount > payment.amount` 시 throw. authors FOR UPDATE 구간 안에서 일관 스냅샷 읽기 → 동시 부분환불도 직렬화. 단건 검사를 누적 검증으로 흡수(주석 L286-294 상세). **다중 부분환불 누적 적자 방어는 견고.**

**경계조건 2 — 환불 트랜잭션 내 payment.status 재검증: [갭]**
`refundPaymentWithPoints`는 트랜잭션 내에서 `select: { amount, points, status }`로 status를 조회하지만(`prisma-payment.repository.ts:271`), **status를 검증하는 throw가 없다**. 이미 `refunded`/`partial_refunded`인 payment에 대한 **트랜잭션 내부 가드 부재**. 차단은 전적으로 ① 진입 전 L341 선검사 ② PAY-S2 누적 한도 ③ 출처 CAS에 의존. 동일 eventId 중복은 L1이 막지만, **서로 다른 eventId의 동시 환불**은 1-3과 동형의 TOCTOU window를 가짐 — 단 이 경우 출처 CAS(`WHERE col >= amount`)와 누적 한도가 두 번째 트랜잭션을 막는다(success 경로 대비 환불은 2차 방어가 존재).

**판정: 부분.** 부분환불 누적은 세밀, 그러나 "3중"의 L3는 멱등성 게이트가 아니라 로그이며, 트랜잭션 내 status 재검증 부재로 엄밀한 3중이라기보다 **L1(eventId) + L2(선검사) + 출처CAS/누적한도(DB 방어)** 구조.

### 1-5. retry 중복 해소 (PAY-P3-C) — **[세밀히 구현]**

`webhook-retry.job.ts:97-106, 164-210` — DLQ 재처리 진입 직전 `applyDedupGate`:
- `findByExternalTransactionId(event.tradeNo)` 조회 → payment.status ∈ {completed, refunded, partial_refunded}(`FINALIZED_STATUSES`, L46-50)면 즉시 `deleteById` + AuditLog `retry_skip_dedup` + skip.
- S1 reconciliation boost나 다른 경로로 이미 종료된 payment의 retry를 차단.
- 테스트: `webhook-retry.job.spec.ts` 14건.

**판정: 세밀히 구현.** DLQ retry가 이미 완료/환불된 결제를 재처리하는 것을 사전 차단.

### 1-6. DLQ upsert 멱등성 — **[세밀히 구현]**

`prisma-webhook-retry-queue.repository.ts:26-45` — `WebhookRetryQueue.eventId @unique`(schema:620) + create P2002 catch → null. retryCount는 `markRetry`로만 증가(createdAt 보존, L60-70). 중복 enqueue 0건.

---

## 축 2 — 영수증/결제 검증 (Verification): **[부분 — 서명 OK, 금액/통화 검증 부재]**

### 2-1. Polar webhook 서명 검증 (HMAC) — **[세밀히 구현]**

`polar.adapter.ts:340-373`:
- `validateEvent(body, headers, this.webhookSecret)` — Standard Webhooks 스펙 HMAC 검증 (`polar-webhooks.ts:16-20` SDK 래퍼).
- `WebhookVerificationError` catch → `null` 반환(L357-361), 위조 webhook 차단.
- raw body 보존: `main.ts:45` express.raw → 서명 대상 바이트 변조 0.
- 테스트: `polar.adapter.spec.ts:435` (서명 실패 → null), L448 (기타 런타임 에러 → null).

**프로덕션 안전 게이트**: `polar.adapter.ts:344-350` — `webhookSecret` 미설정 시 **프로덕션이면 거부**(`isProduction()` → null, L345-348), dev면 검증 스킵(L349 warn). 테스트 입증: `polar.adapter.spec.ts:492`.

**판정: 세밀히 구현.** 위조 차단 + 프로덕션 secret 강제 + raw body 보존.

⚠️ **빈틈 (낮음)**: dev 환경에서 `POLAR_WEBHOOK_SECRET` 미설정 시 서명 검증을 **완전히 스킵**한다(`polar.adapter.ts:349`). dev-api.grimoire-book.com이 공개 엔드포인트이고 secret이 비어 있으면, dev로 위조 webhook 주입 시 서명 우회 → 가짜 결제완료 박제 가능. dev 환경 env에 secret이 실제로 설정돼 있는지는 본 정적 검사 범위 밖(Secret Manager 실측 필요). 코드 자체는 "프로덕션만 강제"라 dev는 운영자 책임 영역.

### 2-2. 금액·통화 검증 (변조 방어) — **[갭 — 명시적 미검증]**

**핵심 발견: webhook의 amount를 DB 기대값과 대조하는 검증이 코드 전체에 없다.**

- `polar.adapter.ts:530-540` `convertToKrw` 주석 verbatim:
  ```
  웹훅 amount는 참고용이므로 고정 환율 적용 (결제 금액 검증은 Polar MoR이 담당).
  ```
- `payment.usecase.ts`에서 `event.amount`는 알림/로깅/`isPartial` 판정에만 사용(grep 결과 L469/495/537/540/571). `payment.amount`(DB 기대 결제액)와 **일치 검증하는 분기 0건**.
- 충전 적립액은 `payment.points`(initiatePayment 시 `product.points`로 박제, `payment.usecase.ts:217-219`)를 신뢰 — webhook이 보낸 금액과 무관하게 DB에 박힌 product 기준으로 적립. **이 점은 오히려 안전** (webhook amount 변조해도 적립 pt는 product 고정).
- 그러나 **결제 성공 자체의 진위**(실제로 그 금액이 결제됐는가)는 검증하지 않고 webhook status='succeeded'만 신뢰. 서명이 유효하면 금액은 묻지 않음.

**위험 평가**: Polar는 MoR(Merchant of Record)이고 서명이 HMAC으로 보호되므로, 서명 검증을 통과한 webhook의 amount는 Polar가 보증한 값이다. 따라서 "서명 유효 = 금액 신뢰 가능"은 MoR 모델에서 **방어적으로 정당화 가능**. 다만:
- **부분환불 비율 계산**(`prisma-payment.repository.ts:307` `ratio = refundedAmount / payment.amount`)이 webhook의 `event.amount`(→ `refundedAmount`)에 **직접 의존**한다. 만약 Polar가 보낸 환불 금액이 비정상(예: 환율 매핑 실패로 `convertToKrw`가 1400 고정환율 폴백, L538-539)이면 환수 pt가 왜곡될 수 있다. `convertToKrw`는 `CREDIT_PRODUCTS.priceUsd === amountCents` 정확 매칭 실패 시 `Math.round((amountCents/100)*1400)` 폴백 — **USD 센트 단위가 product 정의와 1센트라도 다르면** 매칭 실패 → 고정환율 적용 → KRW 환산값이 payment.amount와 불일치 → ratio 왜곡.

**판정: 갭.** 서명 검증은 견고하나 금액/통화 **대조 검증은 명시적으로 위임(Polar MoR)**. 충전 적립은 product 고정이라 안전하지만, **환불 비율 계산이 webhook amount + 고정환율 폴백에 의존**하는 경로는 변조/환율오류에 취약. 통화(currency) 필드는 정규화 단계에서 **아예 읽지 않음**(`polar.adapter.ts:377-387` data 구조 분해에 currency 없음) → USD/KRW 혼동 방어 부재.

### 2-3. PG↔DB 정합 batch (PAY-P0-2 reconciliation cron) — **[부분]**

`payment-reconciliation.job.ts`:
- 10분 주기 cron(`@Cron('0 */10 * * * *')`, L59). 4 시나리오 분기(L113-161):
  - **S1** PG=succeeded + DB=pending → `handleBoost`(completePaymentWithPoints) + AuditLog `reconciliation_boost`. ✅ 누락 webhook 자동 보정.
  - **S2** PG=refunded + DB=completed → `handleRefundMismatch`: **logger.warn + AuditLog `reconciliation_refund_mismatch`만, 실제 환수 0건**(L241-259, `requiresManualRefund: true`). 탐지는 하나 자동 처리 안 함(수동 위임).
  - **S3** PG=NotFound + DB=pending(24h) → `expirePayment` + AuditLog `reconciliation_expire`. ✅
  - **S4** 정합 → skip.
- 동시 cron 차단: in-memory `isRunning` 플래그(L39, L66-73) — **단일 프로세스 한정**. 주석 L27-28 인정: "replicas ≥2 시점에는 advisory_lock 보강 (PAY-P1)". 즉 **Cloud Run 인스턴스 2개 이상이면 cron 중복 실행 가능**.
- checkpoint: `ReconciliationCheckpoint` 단일 row(schema:512, id='singleton'), finally에서 lastRunAt/errorMessage 박제(L170-186) — 예외 시에도 갱신.

**빈틈 1 (중대): reconciliation은 금액 불일치를 탐지하지 않는다.** S1~S4 분기는 오직 **status 조합**(succeeded/refunded/pending/completed)만 비교한다. grep `amount|금액` in reconciliation.job → **0건**. PG checkout amount와 DB payment.amount가 다른 경우(예: 중복 적립, 부분 환불 누락)는 cron이 잡지 못한다. `reconciliation_refund_mismatch`는 status mismatch 전용이지 amount mismatch가 아니다.

**빈틈 2 (중): S2 자동 환수 부재.** PG에서 환불됐는데 DB는 completed인 경우(고객이 Polar에서 직접 환불, webhook 누락) → 크레딧이 회수되지 않은 채 AuditLog만 남는다. "P1-1 위임"이라 명시(L23, L243)되어 있으나 **수동 처리 의존** → 운영자가 AuditLog를 보지 않으면 영구 미회수.

**빈틈 3 (낮음): checkout 단계는 refund status가 없음.** `polar.adapter.ts:644` 주석 — refund는 order 단계 status이고 checkout list에는 안 나옴. 따라서 S2(PG=refunded) 탐지는 **checkout.list 기반이라 실제로는 거의 트리거되지 않음** → S2 자체가 webhook 의존(주석 L644 "S2 mismatch는 webhook 의존"). 즉 reconciliation의 환불 정합 능력은 사실상 제한적.

**판정: 부분.** status 정합 + boost/expire 자동화는 견고하나, **amount 정합 미탐지** + **S2 자동 환수 부재** + **multi-replica advisory lock 부재**.

### 2-4. status enum mapping (PAY-P3-D) — **[부분]**

`domain/model/payment-status.ts`:
- `mapPolarOrderStatus`(L140-150): paid/succeeded → success, refunded → cancel, **default → fail**. 도메인 enum 통일 견고.
- `mapPolarCheckoutStatus`(L175-189): succeeded → SUCCEEDED, expired/failed → FAILED, open/confirmed → OPEN, **default → OPEN**(reconciliation false positive 차단).

**빈틈 (중): `mapPolarOrderStatus` default → 'fail'의 광범위성.** Polar order에 `pending`/`processing`/`partially_refunded` 같은 중간 상태가 오면 모두 `fail`로 매핑된다. `payment.usecase.ts:553-555`에서 `fail`은 `updateStatus(payment.id, 'failed')`로 결제를 **실패 처리**한다.
- 완화 요인: webhook 진입 이벤트 타입이 `order.paid`/`order.updated`로 제한(`polar.adapter.ts:391-392`)되고, order.paid는 status='paid'가 정상. order.updated에서 비정상 status가 오면 fail 처리될 수 있으나, payment.status 선검사(completed면 L325 skip)가 이미 completed된 결제는 보호.
- 단 **pending payment에 order.updated(status=processing 등)가 오면 → fail 매핑 → payment를 failed로 조기 종료** 가능. 이후 실제 order.paid가 와도... payment.status가 'failed'이고 L325는 completed만 체크하므로 재처리는 되지만, 이미 failed로 박제된 혼란.

**판정: 부분.** enum 통일 + 도메인 격리(Prisma/NestJS import 0)는 정합. default → fail이 중간 상태를 과잉 실패 처리할 잠재 위험.

---

## 축 3 — 결제 데이터 저장 (Persistence): **[세밀히 구현]**

### 3-1. 모델 필드 충분성 — **[세밀히 구현]**

`prisma/schema.prisma` 실측:

| 모델 | 핵심 필드 | 정밀도/타임존 | 평가 |
|------|-----------|--------------|------|
| Payment (262) | amount Int, points Int, externalTransactionId **@unique**, status, completedAt | 금액=정수 KRW, 시각=`@db.Timestamptz(3)` | ✅ |
| WebhookEvent (284) | eventId **@unique**, payload Json, status, errorMessage, maskedAt, retentionTier | processedAt Timestamptz(3) | ✅ |
| WebhookRetryQueue (618) | eventId **@unique**, payload, retryCount, lastError, nextRetryAt, maskedAt | Timestamptz(3) | ✅ |
| RefundLog (536) | paymentId, amount, credits(실환수pt), deficitCredits, reason, source | processedAt Timestamptz(3), @@index([paymentId]) | ✅ |
| CreditLedger (561) | source, type, amount(부호有), balanceAfter, expiresAt, relatedId | 정수 pt, Timestamptz(3), 3 index | ✅ |
| AdminAuditLog (491) | adminId, action, targetId, detail Json, maskedAt, retentionTier | Timestamptz(3), 3 index | ✅ |
| Author 크레딧 (28-32) | pointsFree/Subscription/Gift/Charged + deficitPoints | 모두 Int @default(0) | ✅ |

- **금액 정밀도**: 모든 금액 `Int`(KRW 정수), 모든 포인트 `Int`(pt). 부동소수점 0건 → 반올림 오차 없음.
- **타임존**: 모든 시각 컬럼 `@db.Timestamptz(3)` (timezone-aware, ms 정밀). cron timeZone 명시(`audit-mask.job.ts:49` `Asia/Seoul`, "Cloud Run UTC 기준 9시간 어긋남" 방어).
- **외래키 보호**: Payment→Author `onDelete: Restrict`(L265), RefundLog→Payment Restrict(L539), CreditLedger→Author Restrict(L564), AdminAuditLog→Author Restrict(L494) → 결제/감사 row가 있는 사용자 hard-delete 차단(회계 정합).

**판정: 세밀히 구현.** 필드 누락 없음, 정밀도/타임존/FK 보호 견고.

### 3-2. $transaction 원자성 (CLAUDE.md §9) — **[세밀히 구현]**

**충전 완료** (`prisma-payment.repository.ts:55-140`): 단일 `$transaction`에:
1. authors FOR UPDATE 잠금(L68-79) — 동시 차감/적립 직렬화.
2. Payment status='completed' + completedAt(L83-86).
3. deficit 우선 상계 — Author.deficitPoints 갱신 + CreditLedger `deficit_settle` row(L95-112).
4. 남은 충전 적립 — Author.pointsCharged + CreditLedger `earn` row(L115-136).

→ "돈은 냈는데 포인트 없음" 중간 상태 불가. 도메인 순수 함수 `computeChargeLedgerEntries`(L91)로 금액 계산 위임(DIP 정합).

**환불** (`prisma-payment.repository.ts:230-414`): 단일 `$transaction`에:
1. authors FOR UPDATE(L254-265).
2. Payment 조회 + amount validation + **PAY-S2 누적 한도**(L295-305).
3. Payment status 갱신(L315-318).
4. 4 출처 환수 + **출처 컬럼 CAS**(L345-349) + CreditLedger `spend` row.
5. 이중 외상 통합 — deficitPoints 가산 + `deficit_incur` row(L371-390).
6. RefundLog 박제(L396-405).

→ 환수/외상/원장이 단일 트랜잭션. 부분 실패 시 전체 롤백.

**원자성 경계 (의도된 설계, 위험 낮음):** 트랜잭션 **외부** 후행 작업 — AuditLog 박제(`payment.usecase.ts:418-445`), 알림(L464-479), webhookEvent 박제(L448-454)는 try/catch로 감싸 실패해도 throw 0(결제 commit 보존). CLAUDE.md §9 정합. 단 webhookEvent 박제가 트랜잭션 외부이므로, **결제 commit 성공 + webhookEvent 박제 실패** 시 멱등성 1차 게이트(L307)가 다음 재수신에서 작동 안 함 → payment.status 선검사(L325)가 2차 방어(1-3 참조).

**판정: 세밀히 구현.** 돈 관련 로직의 트랜잭션 원자성은 견고. FOR UPDATE 직렬화 + 도메인 순수 함수 분리.

### 3-3. before/after 박제 + audit retention (PAY-P2-5) + DLQ (PAY-P2-2) — **[세밀히 구현]**

**before/after 박제**:
- 충전: `payment.usecase.ts:418-445` — beforeState(pointsCharged) / afterState(chargedAfter + settledDeficit + chargedPoints 메타) 박제. 잔액 사전 조회(L362-374) try/catch.
- 환불: `refund-payment.usecase.ts:147-177` — balanceBefore(4출처+deficit) / afterState 박제. action 분기(refund_normal/deficit/partial/partial_deficit, L137-143).

**audit retention** (`audit-mask.job.ts`): 매일 3시 KST cron. 4 모델(AdminAuditLog/WebhookEvent/WebhookRetryQueue/AccessLog) 90일 경과 row PII 마스킹. **DELETE 0건**(영구 보존, 사용자 옵션 D). 멱등성: `retentionTier='active' AND created_at < cutoff` → 마스킹 후 `retentionTier='masked'` → 재선택 0건(L98-101 등).
- PII 마스킹 헬퍼(`audit-mask-helper.ts`): email/phone/ip/userAgent/token/secret 마스킹 + `maskJsonDeep` 재귀(L171-193) + 멱등성(`isAlreadyMasked` L68-71) + 보존 키 매트릭스(amount/credits/status/eventId 등 회계 본질 보존, L31-63).

**DLQ** (`webhook-retry.job.ts`): 5분 cron. exp backoff(1m→5m→30m→2h→12h→24h, L216-226). MAX_RETRY=10 초과 시 permanent_failed + AuditLog `system_dlq`(L228-257). 비활성화 게이트(WEBHOOK_RETRY_DISABLED). 4xx는 retry 무의미 → 즉시 permanent_failed(`payment.usecase.ts:84-87,128-161`).

**빈틈 (낮음): PII 마스킹 키 매트릭스 한계.** `audit-mask-helper.ts:15-23` PII_KEYS 7건 + 키 이름 패턴 매칭(L132-159). Polar webhook payload의 PII가 **표준 키 이름**(email/customer_email 등)이면 마스킹되나, Polar가 비표준 키(예: `billing_name`, `tax_id`)로 PII를 보내면 매칭 누락 가능. `maskJsonDeep`은 키 기반이라 **값 기반 PII 탐지는 없음**. webhook payload 전체가 Json으로 영구 보존되므로(masked tier여도) 비표준 키 PII는 마스킹 후에도 잔존 가능.

**판정: 세밀히 구현.** before/after + retention(영구보존+90일마스킹+멱등) + DLQ(backoff+DLQ+4xx즉시차단) 모두 실효. PII 키 매트릭스만 비표준 키 한계.

### 3-4. soft-delete 영향 — **[세밀히 구현 — FK Restrict로 보호]**

결제/감사 관련 모델의 Author FK가 전부 `onDelete: Restrict`(3-1 참조). user-soft-delete(`user-soft-delete-policy.ts`)·hard-delete(`user-hard-delete.job.ts`)가 있으나, Payment/RefundLog/CreditLedger/AdminAuditLog row가 있으면 hard-delete가 FK Restrict로 차단됨 → 결제 회계 row 유실 0건.

---

## 발견 빈틈/위험 종합 (우선순위)

| # | 우선순위 | 축 | 발견 | 근거 file:line | 위험 |
|---|---------|-----|------|---------------|------|
| **R1** | **HIGH** | 멱등성 | 충전 적립(success) 경로 Payment.status CAS 부재 — 서로 다른 eventId·동일 결제 동시 success webhook 시 이중 적립 가능 | `prisma-payment.repository.ts:83-86` (status WHERE 없음) vs L167-170(expire만 CAS) | 1회 결제 → 충전 pt 2배 적립. FOR UPDATE는 직렬화만, 중복 실행 미차단 |
| **R2** | **HIGH** | 검증 | reconciliation cron이 금액 불일치 미탐지 (status 조합만 비교) | `payment-reconciliation.job.ts:113-161` (amount grep 0건) | 이중 적립/환불 누락이 정합 batch를 빠져나감 |
| **R3** | **MED** | 검증 | S2(PG환불·DB완료) 자동 환수 부재 — AuditLog만, 수동 위임 | `payment-reconciliation.job.ts:241-259` (`requiresManualRefund:true`) | Polar 직접 환불 + webhook 누락 시 크레딧 영구 미회수 |
| **R4** | **MED** | 검증 | 금액/통화 검증 부재 — 환불 비율이 webhook amount + 고정환율 폴백에 의존, currency 미읽음 | `polar.adapter.ts:534-540`(환율폴백), :377-387(currency 없음), prisma-payment:307(ratio) | 환율 매핑 실패 시 환수 pt 왜곡. USD/KRW 혼동 방어 부재 |
| **R5** | **MED** | 멱등성 | 환불 트랜잭션 내 payment.status 재검증 throw 부재 (status 조회는 하나 미사용) | `prisma-payment.repository.ts:269-272` (select status, 검증 없음) | 출처 CAS·누적한도가 막지만 명시적 트랜잭션 내 가드 부재 |
| **R6** | **MED** | 검증 | `mapPolarOrderStatus` default → 'fail' 광범위 — order 중간 상태(processing 등)를 실패 처리 | `payment-status.ts:147-149` + `payment.usecase.ts:553-555` | pending payment가 order.updated(중간상태)로 조기 failed 박제 가능 |
| **R7** | **LOW** | 멱등성 | webhook event 멱등성 게이트가 status='processed' 단일 비교 (failed/skipped 재처리 허용) | `payment.usecase.ts:307` | 의도된 DLQ 설계. payment.status 선검사가 2차 방어 |
| **R8** | **LOW** | 검증 | dev 환경 webhook secret 미설정 시 서명 검증 완전 스킵 | `polar.adapter.ts:349` | dev 위조 webhook 주입 가능 (운영자 책임 영역, Secret Manager 실측 필요) |
| **R9** | **LOW** | 동시성 | reconciliation/retry/mask cron 동시 실행 차단이 in-memory 플래그 (multi-replica 미보호) | `payment-reconciliation.job.ts:39,66-73`(주석 L27 인정) | Cloud Run replicas≥2 시 cron 중복 실행 |
| **R10** | **LOW** | 저장 | PII 마스킹 키 매트릭스 — 비표준 키 PII(billing_name 등) 마스킹 누락 가능 (값 기반 탐지 없음) | `audit-mask-helper.ts:15-23,171-193` | masked tier에도 비표준 PII 잔존 |

---

## 결제 데이터 처리 성숙도 점수

| 축 | 판정 | 점수 | 근거 요약 |
|----|------|------|-----------|
| **멱등성** | 부분 | **7.5 / 10** | eventId 유니크+게이트+race catch+DLQ dedup은 세밀(축1-1/1-5/1-6). 그러나 **충전 success 경로 status CAS 부재(R1)** + 환불 트랜잭션 내 status 재검증 부재(R5)가 감점. 환불은 출처 CAS/누적한도로 2차 방어 있으나 충전은 무방비 |
| **검증** | 부분 | **6.5 / 10** | 서명 검증(HMAC+프로덕션 강제+raw보존)은 세밀(축2-1). 그러나 **금액/통화 대조 검증 명시적 부재(R4)** + **reconciliation amount 미탐지(R2)** + **S2 자동환수 부재(R3)** + default→fail 과잉(R6)이 누적 감점. 충전 적립은 product 고정이라 변조 안전이 완화 요인 |
| **저장** | 세밀히 구현 | **9 / 10** | $transaction 원자성·FOR UPDATE 직렬화·정수 정밀도·Timestamptz·FK Restrict·before/after·retention(영구+90일마스킹+멱등)·DLQ(backoff) 전부 견고. PII 비표준 키(R10)만 -1 |
| **종합** | **부분 (프로덕션 운영 가능, 보강 권장)** | **7.7 / 10** | 저장 계층은 모범적. 멱등성·검증은 "단일 eventId·정상 흐름"에서는 견고하나 **동시성 엣지(서로 다른 eventId 동시 success)와 금액 정합**에 구조적 빈틈 |

> **거짓 PASS 방지 명시**: 본 검사는 "결제 시스템이 잘 됨"을 단정하지 않는다. 정상 흐름(단일 webhook, 순차 처리)은 견고하나, **충전 success 경로의 동시 이중 적립(R1)은 §0 ZERO-TOLERANCE 관점에서 실재 위험**이며, 기존 테스트(AC-3/AC-6)는 순차 mock 시뮬이라 이 window를 입증하지 못한다(검증 공백). reconciliation이 amount를 안 보므로(R2) 이중 적립이 사후 정합에서도 탐지되지 않는다 — **탐지 사각 + 발생 가능**의 조합이 가장 위험.

---

## 보강 권장 (6건, 우선순위순)

### [P0] 권장 1 — 충전 success 경로 Payment.status CAS 추가 (R1)
`completePaymentWithPoints` 진입부에서 환불 경로의 출처 CAS와 동형으로 Payment.status를 CAS 갱신:
```
const updated = await tx.payment.updateMany({
  where: { id: paymentId, status: 'pending' },
  data: { status: 'completed', completedAt: new Date() },
})
if (updated.count === 0) throw new Error('PAYMENT_ALREADY_FINALIZED — concurrent webhook')
```
→ 두 번째 동시 트랜잭션이 0 row → throw → 적립 0건. `expirePayment`(L167-170)가 이미 쓰는 패턴이라 일관성·검증 비용 낮음. **§0 이중 적립 차단의 핵심.**

### [P0] 권장 2 — reconciliation amount 정합 시나리오 추가 (R2)
`payment-reconciliation.job.ts`에 S5(PG.amount ≠ DB.amount) 분기 추가 → AuditLog `reconciliation_amount_mismatch`. PG checkout amount를 `convertToKrw` 후 payment.amount와 비교(허용 오차 0 또는 환율 폴백 구간 명시). R1으로 새어나간 이중 적립을 사후 탐지하는 안전망.

### [P1] 권장 3 — 환불 비율 계산을 webhook amount 대신 DB 기준으로 (R4)
부분환불 ratio를 `event.amount`(고정환율 폴백 위험) 대신, Polar가 보내는 원천 USD 센트 + payment에 저장된 원 결제 통화/금액으로 계산하거나, ratio 입력을 Polar의 `refunded_amount/order_amount`(같은 통화) 비율로 받도록 정규화. currency 필드를 `verifyAndParseWebhook` 정규화 대상에 추가해 USD/KRW 혼동 차단.

### [P1] 권장 4 — 환불 트랜잭션 내 payment.status CAS (R5)
`refundPaymentWithPoints` Payment status 갱신(L315-318)을 `updateMany WHERE status IN ('completed','partial_refunded')`로 CAS화. 이미 전액 refunded면 0 row → throw. 출처 CAS와 더불어 명시적 status 가드로 멱등성 "3중"을 코드로 완성.

### [P2] 권장 5 — `mapPolarOrderStatus` 중간 상태 명시 처리 (R6)
default → 'fail' 대신 알려진 중간 상태(pending/processing 등)는 별도 'ignore'/'pending' 매핑 추가해 pending payment 조기 failed 박제 방지. order.updated 비정상 status가 결제를 실패 종료시키지 않도록.

### [P2] 권장 6 — cron multi-replica advisory lock (R9) + dev webhook secret 강제 검토 (R8)
reconciliation/retry/mask cron에 Postgres `pg_advisory_lock` 도입(주석에 이미 PAY-P1로 예고됨) — Cloud Run replicas≥2 대비. 별건으로 dev 환경도 webhook secret을 사실상 필수화(Secret Manager에 dev secret 설정 여부 실측 후 결정).

---

## 검사 신뢰성 메모

- **읽기 전용 준수**: 코드 수정·커밋·마이그레이션 0건. 본 리포트 1건만 신규 작성(사용자 명시 산출물).
- **추정 배제**: 모든 판정에 file:line 인용. "CAS 부재"는 grep `WHERE.*status` 결과 success 경로 0건으로 실증(축1-3).
- **테스트 미실행**: `npm test`/`build`는 실행하지 않음(읽기 전용 범위). it() 카운트는 정적 grep. 동작 검증이 아닌 **코드 구조 실측**.
- **검사 범위 밖**: Secret Manager 실제 env 값(R8), Cloud Run replica 수(R9), Polar Dashboard product 정합, 실 prod DB row 정합은 본 정적 검사 밖 — 별도 실측 필요.
- **작가 콘텐츠**: 소설 본문 접근 0건(결제 도메인 무관). ACCOUNTS.md 참조 0건.
