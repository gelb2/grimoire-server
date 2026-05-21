/**
 * 크레딧 개편 I Phase (2026-05-17) — CreditLedger 입출금 원장 포트.
 *
 * 정본: .claude/shared-contracts.md §30 CreditOverhaul
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §5, §11
 *
 * 1-C 하이브리드 — Author 4 필드는 잔액 캐시, 본 원장이 audit 정본.
 * 적립/소진은 $transaction 으로 ledger insert + Author 캐시 동기 갱신
 * (RefundLog 3중 박제 패턴 차용 — shared-contracts §13).
 *
 * 헥사고날 — domain 레이어. Prisma import 0건.
 */

import { CreditSource, CreditLedgerType } from '@domain/model/credit-source'

/** CreditLedger row — 도메인 표현 */
export interface CreditLedgerEntry {
  id: string
  authorId: string
  source: CreditSource
  type: CreditLedgerType
  /** 부호 有 (earn 양수 / spend·expire 음수) */
  amount: number
  /** 이 row 직후 총 잔액 (4 출처 합) */
  balanceAfter: number
  /** 구독풀 row 만 — 다음 리셋일 */
  expiresAt: Date | null
  reason: string
  /** ChatMessage/Payment/AnalysisReport id 약결합 */
  relatedId: string | null
  createdAt: Date
}

/** 출처별 잔액 + 외상 — getBalance 반환 */
export interface CreditBalance {
  free: number
  subscription: number
  gift: number
  charged: number
  /** 4 출처 합 */
  total: number
  /** Author.deficitPoints (외상) */
  deficit: number
  /** total - deficit (실사용 가능) */
  available: number
}

/** spend 결과 — 출처별 차감액 + 외상 발생분 */
export interface SpendResult {
  /** 출처별 차감액 (양수) */
  spentBySource: Record<CreditSource, number>
  /** 외상 발생분 (잔액 부족, 정상 시 0) */
  deficitIncurred: number
  /** 차감 후 총 잔액 */
  balanceAfter: number
}

/** earn 입력 — 적립 1건 */
export interface EarnInput {
  authorId: string
  source: CreditSource
  /** 적립액 (양수) */
  amount: number
  reason: string
  /** 구독풀 적립 시 — 다음 리셋일 (만료 → 이월 차단) */
  expiresAt?: Date
  /** Payment/ChatMessage 등 약결합 id */
  relatedId?: string
}

/** spend 입력 — 소진 1건 */
export interface SpendInput {
  authorId: string
  /** 소진액 (양수 — 내부에서 음수 ledger 로 변환) */
  amount: number
  reason: string
  /** ChatMessage/AnalysisReport 등 약결합 id */
  relatedId?: string
}

/**
 * transfer 결과 (CC-2b — 案 G1) — 응원 선물 양측 작가 1 트랜잭션 이동.
 *
 * sender 측은 `planConsumption` 으로 4 출처에서 소진 우선순위(무료→구독→선물→충전) 차감,
 * receiver 측은 `source='gift'` 단일 출처에 적립. **deficit 금지** — sender 잔액 부족 시 throw
 * (외상 선물 불가, `spend` 와 다른 점).
 */
export interface TransferResult {
  /** sender 출처별 차감액 (양수) — 4 출처 합 = amount */
  senderSpentBySource: Record<CreditSource, number>
  /** receiver 적립 후 `Author.pointsGift` 캐시값 */
  receiverGiftBalance: number
}

export interface CreditLedgerPort {
  /**
   * 적립 — 가입/충전/응원선물/구독풀.
   * $transaction: CreditLedger insert(type='earn') + Author 해당 출처 캐시 가산.
   */
  earn(input: EarnInput): Promise<CreditLedgerEntry>

  /**
   * 소진 — 소진 우선순위(무료적립→구독풀→응원선물→충전) 적용 + 잔액 부족 시 deficit.
   * $transaction: 출처별 CreditLedger insert(type='spend') + Author 캐시 차감
   *               + 부족분 deficit_incur ledger + Author.deficitPoints 가산.
   */
  spend(input: SpendInput): Promise<SpendResult>

  /** 출처별 잔액 + deficit 조회 (Author 캐시 4 필드 + deficitPoints) */
  getBalance(authorId: string): Promise<CreditBalance>

  /**
   * 충전 시 deficit 우선 상계.
   * $transaction: deficit_settle ledger + Author.deficitPoints 차감.
   * @returns 상계된 외상 금액 (충전액에서 차감된 분)
   */
  settleDeficit(authorId: string, fromAmount: number): Promise<number>

  /** 작가의 ledger 이력 조회 (최신순) */
  findByAuthor(authorId: string, limit: number): Promise<CreditLedgerEntry[]>

  /**
   * 응원받는 작가 랭킹 — CC-3 (HIGH-3) 신 ledger 기반.
   *
   * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §5-B / ADR-014.
   *
   * CC-2b 후 선물 적립이 `source='gift', type='earn'` 으로 박제됨에 따라,
   * 구 `CreditRepositoryPort.getGiftRanking`(`CreditLog reason='gift_received'` groupBy)이
   * 신 선물을 보지 못함 → 본 메서드가 `CreditLedger groupBy(authorId)` 로 재집계.
   *
   * @returns 누적 받은 선물 pt 합 내림차순 상위 N건
   */
  getGiftRanking(
    limit: number,
  ): Promise<{ authorId: string; totalGifted: number }[]>

  /**
   * 응원 선물 — 독자(sender) → 작가(receiver) 양측 1 트랜잭션 이동 (CC-2b — 案 G1).
   *
   * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §1-B
   *       .claude/state/sprint-cc2b-gift-refund-wiring-plan-draft.md §2-2
   *
   * CLAUDE.md §9 결제 원자성 — 양측 이동을 단일 `$transaction` 으로 묶는다
   * ("한쪽만 반영"은 §0/§9상 절대 불가):
   *   ① 데드락 방지 lock 순서 — `senderId<receiverId` 비교로 작은 id 먼저
   *     `SELECT ... WHERE id IN ($1,$2) ORDER BY id FOR UPDATE` (giftTransfer 패턴 그대로)
   *   ② sender — `planConsumption`(무료→구독→선물→충전) 으로 4 출처에서 amount 차감.
   *     **deficit 금지** — sender 잔액 부족 시 throw (외상 선물 불가, `spend` 와 다름).
   *     출처별 `CreditLedger spend` row + Author 4 캐시 차감.
   *   ③ receiver — `source='gift'` `earn` row + `Author.pointsGift` 캐시 가산.
   *   ④ 자기 선물(senderId===receiverId) 차단.
   *
   * @param senderId 보내는 작가 id
   * @param receiverId 받는 작가 id
   * @param amount 선물 포인트 (양수 pt 단위 — `GIFT_POINT_OPTIONS` 1,000/3,000/5,000)
   * @param relatedId 약결합 id (예: 'gift_request_id' 등) — null 허용
   * @returns { senderSpentBySource, receiverGiftBalance }
   * @throws Error 자기선물 / sender 미존재 / receiver 미존재 / sender 잔액 부족 / amount<=0
   */
  transfer(
    senderId: string,
    receiverId: string,
    amount: number,
    relatedId?: string,
  ): Promise<TransferResult>
}
