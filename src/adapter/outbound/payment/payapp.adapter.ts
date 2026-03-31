import { Injectable } from '@nestjs/common'
import { createHmac } from 'crypto'
import {
  PaymentGatewayPort,
  PaymentInitRequest,
  PaymentInitResponse,
  WebhookPayload,
} from '@domain/port/outbound/payment-gateway.port'

/**
 * PAYAPP 결제 게이트웨이 어댑터
 * - 결제 요청: PAYAPP API에 POST 전송
 * - 웹훅 검증: HMAC-SHA256 서명 비교
 * - 인증 정보(userId, apiKey, secret)는 어댑터가 자체 관리
 */
@Injectable()
export class PayappAdapter implements PaymentGatewayPort {
  private readonly userId: string
  private readonly apiKey: string
  private readonly webhookSecret: string

  constructor() {
    this.userId = process.env.PAYAPP_USER_ID || ''
    this.apiKey = process.env.PAYAPP_API_KEY || ''
    this.webhookSecret = process.env.PAYAPP_SECRET || ''
  }

  /** PAYAPP API에 결제 요청 전송 */
  async initiatePayment(request: PaymentInitRequest): Promise<PaymentInitResponse> {
    const formData = new URLSearchParams({
      cmd: 'payrequest',
      userid: this.userId,
      goodname: request.productName,
      price: String(request.amount),
      recvphone: '',
      feedbackurl: request.returnUrl,
      memo: `user:${request.userId},product:${request.productId}`,
    })

    const response = await fetch('https://api.payapp.kr/oapi/apiLoad.html', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    })

    if (!response.ok) {
      throw new Error(`PAYAPP API 오류: ${response.status}`)
    }

    const data = await response.json()

    if (data.state !== '1') {
      throw new Error(`PAYAPP 결제 요청 실패: ${data.errorMessage || '알 수 없는 오류'}`)
    }

    return {
      paymentUrl: data.payurl || '',
      tradeNo: data.mul_no || '',
    }
  }

  /** HMAC-SHA256 서명 검증 — 시크릿은 어댑터가 자체 관리 */
  verifyWebhookSignature(payload: WebhookPayload): boolean {
    if (!this.webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        return false // 프로덕션에서 시크릿 미설정 시 모든 웹훅 거부
      }
      return true // 개발 환경에서는 시크릿 없으면 검증 스킵
    }

    const message = `${payload.tradeNo}|${payload.amount}|${payload.status}`
    const expectedSignature = createHmac('sha256', this.webhookSecret).update(message).digest('hex')
    return expectedSignature === payload.signature
  }
}
