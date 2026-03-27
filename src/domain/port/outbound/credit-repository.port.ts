import { CreditLog } from '@domain/model/credit'

export interface CreditRepositoryPort {
  /** 크레딧 차감/적립 + 로그 기록 (트랜잭션) */
  adjustCredits(authorId: string, amount: number, reason: string): Promise<{ credits: number; log: CreditLog }>
  /** 크레딧 로그 조회 */
  findLogsByAuthorId(authorId: string): Promise<CreditLog[]>
  /** 크레딧 선물 (원자적: 보내는 유저 차감 + 받는 유저 적립 + 로그 2건) */
  giftTransfer(senderId: string, receiverId: string, amount: number, senderReason: string, receiverReason: string): Promise<{ senderCredits: number; receiverCredits: number }>
  /** 받은 선물 총액 기준 작가 랭킹 */
  getGiftRanking(limit: number): Promise<{ authorId: string; totalGifted: number }[]>
}
