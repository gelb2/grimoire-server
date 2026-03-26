export interface CreditLog {
  id: string
  authorId: string
  amount: number
  reason: string
  createdAt: Date
}

/** 크레딧 변동 사유 */
export const CreditReason = {
  SIGNUP_BONUS: 'signup_bonus',
  FIRST_WORK_BONUS: 'first_work_bonus',
  THEME_GENERATE: 'theme_generate',
  THEME_REGENERATE: 'theme_regenerate',
  PURCHASE_CREDIT_5: 'purchase_credit_5',
  adminSet: (adminId: string) => `admin_set_by_${adminId}`,
} as const
