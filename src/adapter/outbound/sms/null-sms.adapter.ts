import { Injectable, Logger } from '@nestjs/common'
import {
  PaymentSmsType,
  SmsProvider,
  SmsSendResult,
  SmsServicePort,
} from '@domain/port/outbound/sms-service.port'

/**
 * NullSmsAdapter — 외부 API 신규 의존 0건 default 어댑터 (PAY-P2-3 사전 작업).
 *
 * 정본: `.claude/shared-contracts.md` §19 SmsServicePort + EmailServicePort 패턴 정합.
 *
 * 동작:
 * - 실제 발송 0건 (외부 API 호출 0)
 * - logger.warn 박제 (전화번호 + 코드 일부 마스킹)
 * - messageId=null + provider='null' 반환
 * - isEnabled()=false (UseCase 측에서 fallback 또는 skip 결정 가능)
 *
 * 사용 케이스:
 * - 사용자 절대 규정 0-1 (외부 API 신규 의존 영구 보류) 영역과 동일 정책 적용 시 default
 * - dev / e2e 환경에서 실제 발송 차단
 * - 사용자가 KakaoBizmessage / NhnCloud / Twilio adapter 결정 전까지 기본
 *
 * Provider 결정 게이트:
 * - "SMS 진입" + 1택 (kakao 추천 / nhn / twilio) 사용자 명시 후 별도 sprint
 */
@Injectable()
export class NullSmsAdapter implements SmsServicePort {
  private readonly logger = new Logger(NullSmsAdapter.name)
  private static readonly PROVIDER: SmsProvider = 'null'

  async sendPaymentNotification(input: {
    to: string
    type: PaymentSmsType
    displayName?: string
    payload: Record<string, unknown>
  }): Promise<SmsSendResult> {
    this.logger.warn(
      `[NullSmsAdapter] sendPaymentNotification skipped — to=${this.maskPhone(input.to)} type=${input.type}`,
    )
    return { messageId: null, provider: NullSmsAdapter.PROVIDER }
  }

  async sendVerificationCode(input: {
    to: string
    code: string
    displayName?: string
    expireAt: Date
  }): Promise<SmsSendResult> {
    this.logger.warn(
      `[NullSmsAdapter] sendVerificationCode skipped — to=${this.maskPhone(input.to)} code=${this.maskCode(input.code)} expireAt=${input.expireAt.toISOString()}`,
    )
    return { messageId: null, provider: NullSmsAdapter.PROVIDER }
  }

  isEnabled(): boolean {
    return false
  }

  getProviderName(): SmsProvider {
    return NullSmsAdapter.PROVIDER
  }

  /** 전화번호 PII 마스킹 — 로그에 평문 박제 차단 (예: +821012345678 → +8210****5678) */
  private maskPhone(phone: string): string {
    if (phone.length <= 4) return '***'
    const head = phone.slice(0, Math.min(4, phone.length - 4))
    const tail = phone.slice(-4)
    return `${head}****${tail}`
  }

  /** 인증코드 마스킹 — 처음 1자 + *** 박제 (6자리 코드 기준) */
  private maskCode(code: string): string {
    if (code.length <= 2) return '***'
    return `${code[0]}***`
  }
}
