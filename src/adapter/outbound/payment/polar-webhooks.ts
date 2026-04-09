/**
 * Polar SDK webhooks subpath 래퍼
 *
 * - `@polar-sh/sdk`의 exports map은 `./*` → `./dist/commonjs/*.js`로 매핑.
 *   따라서 `@polar-sh/sdk/webhooks`가 표준 경로이다.
 * - 과거에 `@polar-sh/sdk/dist/commonjs/webhooks`를 직접 참조했더니
 *   컨테이너(Node exports 엄격 적용)에서 `dist/commonjs/dist/commonjs/webhooks.js`로
 *   이중 매핑되어 `MODULE_NOT_FOUND`로 부팅 실패.
 * - 이 래퍼는 `@polar-sh/sdk/webhooks`를 한 곳에 캡슐화하여 테스트에서 이 모듈만
 *   mock하면 되도록 한다.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require('@polar-sh/sdk/webhooks')

export const validateEvent: (
  body: string | Buffer,
  headers: Record<string, string>,
  secret: string,
) => { type: string; data: unknown } = mod.validateEvent

export const WebhookVerificationError: new (message?: string) => Error =
  mod.WebhookVerificationError
