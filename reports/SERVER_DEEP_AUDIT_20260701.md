# grimoire-server 전수조사 심층 감사 — SERVER_DEEP_AUDIT

- 일자: 2026-07-11 (파일명은 지시서 지정값 유지)
- 대상: `grimoire-server` — 지시서 명시 `develop 1f4f51e`. **실측 HEAD = `main 84772a8`** (1f4f51e의 자손 1커밋, 동일 감사분의 prod 승격 커밋. `git cat-file -t 1f4f51e` = commit 확인). 코드 델타 없음.
- 방식: 읽기 전용. 코드 수정 0건. §0 ZERO-TOLERANCE — 전 발견 file:line + raw 코드 인용. 추정 배제.
- 카운트: 🔴 0 / 🟠 1 / 🟡 5 / 🟢 5 (총 11)
- 제외 항목(지시서 명시 known/의도)은 재보고하지 않음.

---

## 심각도순 발견

### S-1 | 🟠 기능파손 | 버그 | `prisma-work.repository.ts:159-199` (computeRankedWorks) + `:142-148` (searchByTitle) + `prisma-soft-delete.middleware.ts:150` + `user-soft-delete.usecase.ts:79-87`

**증상 → 영향**: soft-delete(자진탈퇴/운영자 강제)된 작가의 works가 discovery popular/recent 목록과 제목 검색에 **계속 노출**된다(카드 렌더 → 클릭 시 404 dead link). `UserSoftDeleteUseCase.execute`는 Author만 soft-delete + PII(name/email/bio) 익명화하고 **works는 미조치**(unpublish/hide 없음). 소프트삭제 확장은 `author` 모델 top-level op만 필터(`author: { $allOperations }`) — `work.findMany`의 nested `include: { author }`나 Work 자체는 미필터. 게다가 Work→Author `onDelete: Restrict`(schema:105)로 인해 works/payment/ledger가 있는 작가는 `hardDeleteOlderThan`이 `blockedIds`로 보류 → **30일 hard-delete가 영구 미해소** → 목록 잔존이 self-heal 안 됨. 슬러그 직접 접근(`getWorkDetail`/`getEpisode`)은 `author.findUnique`(필터됨)로 차단되나(=본문 보호), 브라우즈/검색 목록의 제목·커버 메타는 잔존.

**근거(코드 인용)**:
```ts
// prisma-work.repository.ts — computeRankedWorks (findPopular/findRecent/*Paginated 공용)
this.prisma.work.findMany({ include: { author: { select: { name: true, slug: true } }, ... } }),  // author.deletedAt 필터 없음
// searchByTitle
where: { title: { contains: query, mode: 'insensitive' } },   // author 조건 없음
// prisma-soft-delete.middleware.ts — 확장 대상은 author 모델뿐
query: { author: { $allOperations: authorSoftDeleteCallback(prisma) } }
// user-soft-delete.usecase.ts — works 관련 조치 0건
await this.authorRepo.softDelete(authorId)          // Author만
await this.userAnonymizer.anonymize(authorId, ...)  // name/email/bio 4필드
```
(대조: `findByAuthorAndWorkSlug`/`findEpisode`는 `const author = await this.prisma.author.findUnique(...); if (!author) return null` → 슬러그 경로는 보호됨)

**픽스 방향**: discovery/search Work 쿼리에 `where: { author: { is: { deletedAt: null } } }` 추가, 또는 soft-delete 시 해당 작가 works status→nonPublic 카스케이드. **규모: S**

---

### S-2 | 🟡 정합·운영 | 버그 | `payment.controller.ts:39-44` + `polar.adapter.ts:340-364` + `payment.usecase.ts:275-276`

**증상 → 영향**: 무서명/위조/파싱실패 웹훅 → `verifyAndParseWebhook`가 `null` 반환 → `processWebhook`가 `{ processed:false, reason:'invalid_or_ignored' }` → 컨트롤러가 **HTTP 201(silent ack)** 반환(실측: 빈 body → 201). **위조 이벤트가 처리 로직에 도달하는 경로는 없음 — HMAC 게이트는 유효**(적립/완료 0건). 그러나 201 ack는 Polar가 "전달 성공"으로 간주 → **재전송 중단**. success 경로는 reconciliation S1(PG=succeeded·DB=pending→boost, 10분)이 자동 보정하나, secret 회전 불일치 등으로 **order.refunded**가 검증 실패하면 reconciliation S2는 기록만(자동환수0, 제외항목) → 수동 개입 필요. 즉 표준(4xx로 재전송 유도) 대비 실패 마스킹.

**근거(코드 인용)**:
```ts
// payment.controller.ts — @SkipThrottle() @Post('webhook'); 반환값 그대로 → NestJS POST 기본 201
return this.paymentUseCase.processWebhook(rawBody, headers)
// polar.adapter.ts — 서명/파싱 실패는 전부 null
if (e instanceof WebhookVerificationError) { this.logger.warn(...); return null }
this.logger.error(`Polar 웹훅 파싱 실패: ${String(e)}`); return null
// eventId 누락도 return null
// payment.usecase.ts
if (!event) return { processed: false, reason: 'invalid_or_ignored' }
```

**픽스 방향**: 컨트롤러에서 verify 실패(null이면서 이유가 invalid) 시 `throw new BadRequestException/UnauthorizedException`으로 4xx 반환(무시 대상 이벤트=200 유지 구분). **규모: S**

---

### S-3 | 🟡 정합 | 오구현 | `charge-points.usecase.ts:226-234` (refundTheme) + `:204-217` (chargeTheme) + `generate-theme.usecase.ts:63-65`

**증상 → 영향**: 테마 생성 AI 실패 시 환불(590pt)이 **항상 `source:'charged'`로 적립**된다. `chargeTheme`는 `Promise<void>`라 `SpendResult.spentBySource`를 반환·보존하지 않아 출처별 복원이 구조상 불가. CC-1 §5-D가 `refundAnalysis`에 적용한 "차감 출처별 정확 복원"이 **테마에는 미적용** → subscription/free/gift에서 차감된 590pt가 charged로 둔갑. §0 원가 COGS/CAC 회계 왜곡(refundAnalysis 주석이 "무료적립/구독풀 차감분이 충전으로 둔갑"으로 명시 경계한 바로 그 클래스) + subscription pt는 월 만료·charged는 비만료라 사용자에 미소 이득/플랫폼 손실.

**근거(코드 인용)**:
```ts
// refundTheme — 하드코딩 charged
await this.ledger.earn({ authorId, source: 'charged', amount: THEME_POINT_COST, reason: 'theme_generate_refund', relatedId })
// chargeTheme — SpendResult 미반환(void)
async chargeTheme(authorId: string, relatedId?: string): Promise<void> { ... await this.ledger.spend({...}) }
// generate-theme.usecase.ts
} catch (error) { if (!isFree) { await this.chargePoints.refundTheme(authorId) } throw error }
```
(대조: `refundAnalysis(authorId, relatedId, spentBySource)` — 출처별 복원. `analyzeEpisode`가 `spendResult.spentBySource` 보존 후 전달)

**픽스 방향**: `chargeTheme`가 `SpendResult` 반환 → `generate-theme`가 보존 → `refundTheme(authorId, spentBySource)` 출처별 복원(refundAnalysis 패턴 이식). **규모: S**

---

### S-4 | 🟡 정합·운영 | 오구현(dead config) | `env.validation.ts:39-51`

**증상 → 영향**: `optionalGroups`가 **폐기된 레거시 PAYAPP** 키(`PAYAPP_USER_ID/PAYAPP_API_KEY/PAYAPP_SECRET`)를 검증(미설정 시 warning `'Payment disabled'`) — 실제 결제는 Polar(`payment-gateway.port.ts:5` "과거 구현체: PayappAdapter ... 폐기"). 결과: prod 부팅 시 **항상 오해성 경고**("결제 disabled"인데 실제로는 정상), 그리고 실사용 `POLAR_ACCESS_TOKEN`/`POLAR_WEBHOOK_SECRET`은 **무검증**. `remoteRequired` 배열이 비어(`:26`) 있어 원격환경 필수 검증 루프가 무동작 → prod에서 Polar secret 누락해도 부팅 성공 + 결제 silent 파손(webhook은 isProduction()→reject, reconciliation이 일부 보완).

**근거(코드 인용)**:
```ts
{ keys: ['PAYAPP_USER_ID', 'PAYAPP_API_KEY', 'PAYAPP_SECRET'], warning: 'Payment disabled' },  // :43 — 죽은 키
const remoteRequired: { key: string; label: string }[] = []   // :26 — 비어있음 → 아래 루프 무동작
```

**픽스 방향**: PAYAPP 그룹 삭제, `POLAR_ACCESS_TOKEN`·`POLAR_WEBHOOK_SECRET`을 `remoteRequired`(원격 필수) 또는 optionalGroups로 교체. **규모: XS**

---

### S-5 | 🟡 edge | 버그 | `charge-points.usecase.ts:134-155` (chargeAnalysis) + `novel-analysis.usecase.ts:135-141` (refund) + `prisma-credit-ledger.repository.ts:164-184` (spend deficit)

**증상 → 영향**: 분석은 사전 `available < ANALYSIS_POINT_COST` 체크 후 spend하나, 동시 요청 race로 두 분석이 체크를 통과 후 두 번째가 `deficitIncurred>0`를 유발할 수 있다(코드 주석이 "동시성으로 발생 가능" 명시). 이때 AI 실패 → `refundAnalysis(spentBySource)`는 **실차감 출처만 복원하고 deficit분은 미역전** → 실패한 분석인데 잔여 외상(≤2,440pt)이 남음. 사전 체크 + 분석 3/min throttle로 협소하고, 다음 충전 시 `settleDeficit` 자동 상계로 self-heal되므로 저심각.

**근거(코드 인용)**:
```ts
// charge-points.usecase.ts — deficit 발생 가능성 인정
if (result.deficitIncurred > 0) { this.logger.warn(`분석 차감 중 deficit 발생 (동시성 — ...)`) }
// novel-analysis.usecase.ts — 환불은 spentBySource(실차감분)만
await this.chargePoints.refundAnalysis(authorId, undefined, spentBySource as ...)
// prisma-credit-ledger.repository.ts — spentBySource는 deficit분 미포함
if (plan.deficitIncurred > 0) { ...deficitPoints 가산... }  // 별도, spentBySource엔 미반영
```

**픽스 방향**: `refundAnalysis`가 `SpendResult.deficitIncurred`도 받아 `settleDeficit`로 상계(또는 chargeAnalysis를 spend 대신 deficit-불가 경로로). **규모: S**

---

### S-6 | 🟡 정합 | 버그(주석-실상 불일치 + 협소 revenue leak) | `chat.usecase.ts:157-182`

**증상 → 영향**: 채팅 사후 차감 실패를 catch로 삼키며 주석이 "다음 정합 cron이 보정"이라 명시하나 **chat-charge 보정 cron은 부재**(grep: `chargeChatTurn` 호출처는 chat.usecase 1곳뿐, reconciliation은 결제 PG↔DB 전용). 즉 `chargeChatTurn` throw 시(예: DB 오류) AI 원가 발생분이 **영구 미회수**. 단 잔액부족은 throw 아니라 deficit 흡수라 throw 케이스가 협소.

**근거(코드 인용)**:
```ts
} catch (e: unknown) {
  // 차감 실패는 응답 제공을 막지 않음 — 로그만 (사후 차감 — 다음 정합 cron 이 보정)  ← 그 cron 없음
  this.logger.error(`채팅 사후 차감 실패 (...): ${msg}`)
}
```

**픽스 방향**: 주석 정정 + 실패분 재시도 큐/보정 잡 도입(webhook DLQ 패턴 차용) 또는 실패 시 deficit 강제 박제. **규모: S**

---

### S-7 | 🟢 사소 | 버그(dead code) | `domain/model/plan.ts:2-9`

**증상 → 영향**: `isPlanExpired(plan, planExpireAt)`(案 A 잔재)는 **호출처 0건**(grep 확인 — 정의만). 게이팅은 全 `isMembershipExpired(status 기반)`으로 이행됨. 死코드.
**근거**: `grep -rn "isPlanExpired" src` → `plan.ts:2/6/8`(정의)뿐. **픽스**: 삭제. **규모: XS**

### S-8 | 🟢 사소 | 오구현 | `prisma-membership-plan.repository.ts:38-104` (resetMonthlyPool)

**증상 → 영향**: 월 풀 리셋 시 `poolResetAt`는 갱신하나 `MembershipPlan.expiresAt` / `Author.planExpireAt`(案 A 미러)는 **미갱신** → 표시용 만기일이 첫 달 값에서 stale. **게이팅은 status 기반이라 무영향**(cosmetic). Polar renewal의 `changeTier` 재호출 시 갱신되어 사실상 self-heal.
**근거**: resetMonthlyPool은 `monthlyPoolPoints/poolBalance/poolResetAt`만 update, `expiresAt`/`planExpireAt` 없음. **픽스**: 표시 정확성 필요 시 expiresAt도 nextResetAt로 갱신. **규모: XS**

### S-9 | 🟢 사소 | 버그 | `prisma-admin.repository.ts:135-136`

**증상 → 영향**: `hideEpisode`/`deleteCommentById`가 `.catch(() => {})`로 **모든 예외 삼킴**(P2025 record-not-found 포함) → 운영자에 silent 실패(실제 안 됐는데 성공 응답).
**근거**: `...update({...}).catch(() => {})` / `...delete({...}).catch(() => {})`. **픽스**: not-found만 무시하고 그 외 재throw. **규모: XS**

### S-10 | 🟢 사소 | 정합(주석-실상) | `polar.adapter.ts:344-350`

**증상 → 영향**: `!webhookSecret && !isProduction()` 분기 주석 "dev 환경에서 서명 검증 스킵"이나 코드는 return/skip 없이 `validateEvent(body, headers, '')`(빈 secret)로 fall-through → 실제 스킵 아님. **prod는 `isProduction()`→`return null` reject로 안전**. dev 전용 혼선.
**근거**: `this.logger.warn('...서명 검증 스킵')` 직후 그대로 `event = validateEvent(...)` 진입. **픽스**: 주석 정정 또는 dev 분기에서 명시적 우회. **규모: XS**

### S-11 | 🟢 사소 | edge | `prisma-work.repository.ts:267-270` (findBySharedToken) + reader library

**증상 → 영향**: 공유 토큰 조회는 `episode.findUnique({ where: { sharedToken } })`로 **author.deletedAt 미확인** → soft-deleted 작가의 shared 에피소드가 토큰으로 접근 가능(S-1 cascade 계열). 토큰은 의도적 시크릿·만료 有라 협소.
**근거**: `const row = await this.prisma.episode.findUnique({ where: { sharedToken: token } })`. **픽스**: 토큰 조회 후 소유 작가 deletedAt 검증 추가. **규모: XS**

---

## 축별 정상 확인 (이상 없음 — 확인 내역 명시)

- **축1 인증/인가**: work/episode(work-management.usecase 전 mutation `work.authorId !== authorId → Forbidden`), theme/chat/analysis/social(comment delete는 `comment.authorId !== authorId`, 익명은 bcrypt) 소유권 일관. admin 40+ endpoint 전부 `@UseGuards(JwtAuthGuard, AdminGuard)`(login만 throttle 5/min). refresh rotation(`revoke(stored.id)`→새 쌍 발급)+`revokeAllByAuthorId`+hash 저장 정상. 전역 `ThrottlerGuard`(APP_GUARD, 60/min) + endpoint별 `@Throttle` → **S-2(webhook 201) 외 이상 없음**. (theme mutation 일부 명시 @Throttle 없으나 전역 60/min 적용 — 무발견)
- **축3 크레딧 원장**: earn/spend/settleDeficit/transfer 전부 `$transaction`+`SELECT ... FOR UPDATE`(gift는 id 오름차순 lock으로 데드락 방지). `$queryRawUnsafe`는 파라미터 바인딩($1). **expiresAt: free/gift/charged는 전부 `expiresAt=null`(비만료 설계, grant-points 전 경로 확인), subscription pool만 expiresAt 有 + resetMonthlyPool cron + checkAndResetExpiredPool lazy 이중 enforce → 만료 정합.** getBalance는 Author 4캐시, ledger balanceAfter도 캐시 기반 → 트랜잭션 내 일관. 음수/한도 방어(earn>0, spend>0, deficit 상한 isChatBlocked). → 이상 없음(concurrency edge는 S-5).
- **축4 구독/멤버십**: `changeTier`가 MembershipPlan + Author.plan/planExpireAt 미러를 **동일 $transaction 동기**(案 B), 게이팅은 `isMembershipExpired(status)`/`resolveTierOrFree(status)` → 이중출처 회귀 없음. reset cron 경계(poolResetAt lte now, pro/premium만) 정합. → 이상 없음(표시 stale은 S-8).
- **축5 콘텐츠**: 슬러그 접근은 `author.findUnique`(soft-delete 필터)→null 차단으로 본문 보호. works/episodes CRUD 소유권 검증(축1). 노출 벡터는 S-1(discovery/search)·S-11(token). **works.context AI 사과문 필터: 부재 확인(grep 1회, known-open) — userMessage는 `guardPromptInjection` 통과, workContext/ragContext는 작가 본인 원고(신뢰 입력)**. 파서 edge(빈/미지원 포맷)는 `parseContentWithMeta`가 BadRequest + frontmatter try/catch 폴백.
- **축6 AI 차감→환불**: analysis는 소유권→차감→AI→실패 시 출처별 refund + AbortSignal을 SDK까지 전파(백그라운드 토큰 0). theme는 S-3, chat은 S-6. prompt injection guard(theme/chat) 존재. → race/timeout 방어 존재, 발견은 S-3/S-5/S-6.
- **축7 @Cron**: 6개 job(payment-cleanup/reconciliation/webhook-retry/user-hard-delete/audit-mask/reset-monthly-pool) 전부 `isRunning` in-memory lock + `*_DISABLED` env gate + per-item try/catch 격리(1건 실패가 배치 중단 안 함). webhook DLQ: 4xx 즉시 permanent_failed(retry 0), exp backoff(1m→24h), MAX_RETRY 10, 사전 dedup(finalized status). → 이상 없음. (multi-instance advisory lock 미도입은 주석 명시된 알려진 유예 — money path는 Payment status CAS + webhook eventId `@unique` + completePaymentWithPoints alreadyCompleted로 DB 레벨 보호되어 무해)
- **축8 에러 처리**: `GlobalExceptionFilter`가 prod에서 message/stack 은닉(dev만 노출). 돈 경로 전부 `$transaction`(부분 커밋 방지). 삼킨 예외는 S-9(admin)뿐, 그 외 `.catch(()=>{})`는 fire-and-forget 통계/RAG 인덱싱(의도, 주석 확인). → 이상 없음.
- **축9 환경/설정**: 필수 env(DATABASE_URL/JWT_SECRET/CORS_ORIGIN/PUBLIC_API_BASE_URL) 부재 시 `process.exit(1)`. CORS는 `origin: process.env.CORS_ORIGIN`(비-wildcard) + validateEnv 강제. main.ts webhook raw body(`express.raw`)가 json 파서보다 먼저 등록. 발견은 S-4(PAYAPP dead config + Polar secret 무검증).
- **축10 스키마**: unique 방어 촘촘 — `eventId @unique`(webhook_events+retry_queue), `external_transaction_id @unique`, `tokenHash @unique`(refresh+email verify), `polar_subscription_id @unique`, `(provider,providerId)`, `(authorId,episodeId)`(like/bookmark/progress), `(workId,date)`(daily_stats), `(authorId,slug)`/`(workId,slug)`. onDelete: 회계 보존 Restrict(Work/Payment/CreditLedger/Sanction/MembershipPlan→Author), 종속 Cascade(Episode/Chat/Like 등), 감사 SetNull. → 이상 없음(Restrict가 S-1의 hard-delete 미해소를 유발하나 회계 보존은 의도).
- **축11 테스트 공백**: S-1(discovery soft-delete 작가 제외) 무 spec — `discovery.usecase.spec.ts`는 repo mock이라 쿼리 필터 갭 미검출. S-3(refundTheme 출처) — spec 존재하나 "환불 발생"만 검증, 출처 오귀속 미검. S-2(webhook 201 vs 4xx) — polar.adapter.spec는 null 반환만 검증(201 semantic 미검). → 크리티컬 경로 중 S-1/S-2/S-3 회귀 방지 spec 필요.

---

## 부록 — 검증 커맨드(재현용)
- git: `git rev-parse HEAD`(84772a8) / `git cat-file -t 1f4f51e`(commit)
- 무가드 mutation 스캔: 각 controller `@(Post|Patch|Put|Delete)` vs `@UseGuards` 대조(전수) — auth/social 익명은 OptionalAuthGuard 의도, webhook은 SkipThrottle+HMAC.
- cron 가드: `for f in $(find src -name "*.job.ts"); grep isRunning; grep *_DISABLED` → 6/6.
- PAYAPP: `grep -rn "PAYAPP" src` → env.validation.ts:43(dead) + payment-gateway.port.ts:5(주석).
- expiry: `grep -rn "expiresAt" src` → subscription pool만 non-null.
