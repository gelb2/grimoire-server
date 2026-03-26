import { CreditLog } from '@domain/model/credit'

export interface CreditRepositoryPort {
  /** 크레딧 차감/적립 + 로그 기록 (트랜잭션) */
  adjustCredits(authorId: string, amount: number, reason: string): Promise<{ credits: number; log: CreditLog }>
  /** 크레딧 로그 조회 */
  findLogsByAuthorId(authorId: string): Promise<CreditLog[]>
}
