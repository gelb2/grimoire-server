/**
 * 크레딧 개편 CC-4 Phase 1 (2026-05-21) — `CreditReason` enum 폐기.
 *
 * 신 reason 문자열은 `CreditLedger.reason`(자유 문자열)을 직접 사용 — `signup_bonus`/
 * `first_work_bonus`/`gift_sent:<authorId>`/`admin_grant:<reason>` 등 합의된 prefix 규약.
 * (정본: shared-contracts.md §30 CreditOverhaul, .claude/state/sprint-cc1-*.md 박제.)
 *
 * `CreditLog` interface 는 `prisma-credit.repository` (Phase 3 폐기 예정) 잔존 폴백용으로 유지.
 */
export interface CreditLog {
  id: string
  authorId: string
  amount: number
  reason: string
  createdAt: Date
}
