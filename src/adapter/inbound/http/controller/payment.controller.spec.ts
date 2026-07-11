import { PaymentController } from './payment.controller'
import { BadRequestException } from '@nestjs/common'
import { WebhookVerificationFailedError } from '@domain/model/webhook-verification-error'

/**
 * F-13 (2026-07-11) — webhook 무효서명 4xx spec.
 *
 * 구: verifyAndParse null → { processed:false } → 컨트롤러 201(silent ack) → Polar 재전송 중단.
 * 신: 무효(서명/파싱/eventId)는 어댑터 throw → 컨트롤러 400. 정상 unknown 이벤트 ack 는 유지.
 */
describe('PaymentController.webhook — F-13', () => {
  let controller: PaymentController
  let mockPaymentUseCase: { processWebhook: jest.Mock }

  const req = { body: Buffer.from('{}') } as any
  const headers = { 'webhook-id': 'evt_1' }

  beforeEach(() => {
    mockPaymentUseCase = { processWebhook: jest.fn() }
    controller = new PaymentController(mockPaymentUseCase as any, {} as any)
  })

  it('서명검증 실패(WebhookVerificationFailedError) → 400 BadRequest', async () => {
    mockPaymentUseCase.processWebhook.mockRejectedValue(
      new WebhookVerificationFailedError('signature_verification_failed'),
    )
    await expect(controller.webhook(req, headers)).rejects.toThrow(BadRequestException)
  })

  it('정상이나 처리 대상 아닌 이벤트(ignored) → 2xx ack (throw 없음)', async () => {
    mockPaymentUseCase.processWebhook.mockResolvedValue({ processed: false, reason: 'ignored' })
    await expect(controller.webhook(req, headers)).resolves.toEqual({
      processed: false,
      reason: 'ignored',
    })
  })

  it('정상 결제 처리 → 결과 그대로 반환', async () => {
    mockPaymentUseCase.processWebhook.mockResolvedValue({ processed: true, credits: 5000 })
    await expect(controller.webhook(req, headers)).resolves.toEqual({
      processed: true,
      credits: 5000,
    })
  })

  it('그 외 예외(SDK 처리 오류 등)는 400 으로 삼키지 않고 그대로 전파(→5xx, Polar 재시도)', async () => {
    mockPaymentUseCase.processWebhook.mockRejectedValue(new Error('polar timeout'))
    // BadRequest 로 변환되지 않고 원본 메시지 그대로 전파
    await expect(controller.webhook(req, headers)).rejects.toThrow('polar timeout')
  })
})
