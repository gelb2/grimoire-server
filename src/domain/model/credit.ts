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
  NOVEL_ANALYSIS: 'novel_analysis',
  NOVEL_ANALYSIS_REFUND: 'novel_analysis_refund',
  PURCHASE_CREDIT_5: 'purchase_credit_5',
  GIFT_SENT: 'gift_sent',
  GIFT_RECEIVED: 'gift_received',
  adminSet: (adminId: string) => `admin_set_by_${adminId}`,
  giftSent: (receiverSlug: string) => `gift_sent_to_${receiverSlug}`,
  giftReceived: (senderSlug: string) => `gift_received_from_${senderSlug}`,
} as const
