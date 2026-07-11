/**
 * F-13 (2026-07-11) — 웹훅 검증/파싱 실패를 나타내는 도메인 에러.
 *
 * 배경: PaymentGatewayPort.verifyAndParseWebhook 이 서명검증 실패·파싱 불가·eventId 누락을
 *       모두 `null` 로 반환해 usecase 가 `{ processed:false }` → 컨트롤러가 HTTP 201(silent ack)
 *       을 돌려줬다. Polar 는 201 을 "전달 성공"으로 간주 → 재전송 중단(실패 마스킹).
 *
 * 방침: 어댑터는 **무효(서명검증 실패/파싱 불가/eventId 누락)** 를 이 도메인 에러로 throw 하고,
 *       **정상이나 미처리 대상 이벤트**(알 수 없는 type 등)는 계속 `null` 을 반환한다.
 *       inbound 컨트롤러가 이 에러를 400(BadRequest)으로 매핑한다 — 도메인은 HTTP 를 모른다.
 */
export class WebhookVerificationFailedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'WebhookVerificationFailedError'
  }
}
