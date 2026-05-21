import { CreditLog } from '@domain/model/credit'

/**
 * 크레딧 개편 CC-4 Phase 1 (2026-05-21) — 폐기 port. Phase 3 에서 인터페이스 자체 제거 예정.
 *
 * 잔존 시그니처 (CC-1·CC-2b·CC-3 폴백 잔존용 — Phase 3 에서 일괄 제거):
 *   - `findLogsByAuthorId(authorId)` — `CreditUseCase.getLogs` ledger 미주입 폴백 (테스트용).
 *   - `getGiftRanking(limit)` — `CreditUseCase.getGiftRanking` ledger 미주입 폴백 (테스트용).
 * 제거된 시그니처 (Phase 1):
 *   - `adjustCredits` — 차감/적립 8경로 전부 `ChargePointsUseCase`/`GrantPointsUseCase` 이행 완료.
 *   - `giftTransfer` — 선물은 `CreditLedgerPort.transfer` 신 경로 단일.
 *   - `sumNegativeAmounts` — `CreditLedgerPort.sumSpendByAuthor` 신 경로 단일.
 */
export interface CreditRepositoryPort {
  /** 크레딧 로그 조회 — CC-3 이후 ledger 미주입 시 폴백 경로 */
  findLogsByAuthorId(authorId: string): Promise<CreditLog[]>
  /** 받은 선물 총액 기준 작가 랭킹 — CC-3 이후 ledger 미주입 시 폴백 경로 */
  getGiftRanking(limit: number): Promise<{ authorId: string; totalGifted: number }[]>
}
