/**
 * Polar SDK webhooks subpath 래퍼
 *
 * - `@polar-sh/sdk/webhooks`는 subpath exports를 통해 제공되지만
 *   현재 `moduleResolution=node` (classic)와 Jest 기본 해석기가 이를 지원하지 않음.
 * - 직접 경로 `@polar-sh/sdk/dist/commonjs/webhooks`는 TypeScript에서는 동작하지만
 *   Jest의 package exports 검사에서 차단됨.
 * - 이 래퍼는 그 경로를 한 곳에 캡슐화하여 테스트에서 이 모듈만 mock하면 되도록 한다.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require('@polar-sh/sdk/dist/commonjs/webhooks')

export const validateEvent: (
  body: string | Buffer,
  headers: Record<string, string>,
  secret: string,
) => { type: string; data: unknown } = mod.validateEvent

export const WebhookVerificationError: new (message?: string) => Error =
  mod.WebhookVerificationError
