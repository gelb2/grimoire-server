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
}
