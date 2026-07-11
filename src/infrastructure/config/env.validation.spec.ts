/**
 * env.validation 스펙
 *
 * P1-#7 (2026-05-03): PUBLIC_API_BASE_URL 필수 검증 박제
 *
 * process.exit를 모킹하여 fail-fast 동작을 검증한다.
 */

import { validateEnv } from './env.validation'

describe('validateEnv', () => {
  let originalEnv: NodeJS.ProcessEnv
  let exitSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    originalEnv = { ...process.env }
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = originalEnv
    exitSpy.mockRestore()
    errorSpy.mockRestore()
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  function setRequiredEnv(overrides: Record<string, string | undefined> = {}): void {
    const base: Record<string, string | undefined> = {
      DATABASE_URL: 'postgresql://localhost:5432/test',
      JWT_SECRET: 'test-secret',
      CORS_ORIGIN: 'http://localhost:3001',
      PUBLIC_API_BASE_URL: 'http://localhost:3000/api',
    }
    const merged = { ...base, ...overrides }
    for (const [key, value] of Object.entries(merged)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }

  it('필수 환경변수가 모두 있으면 정상 통과', () => {
    setRequiredEnv()
    expect(() => validateEnv()).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('PUBLIC_API_BASE_URL 누락 시 process.exit(1)', () => {
    setRequiredEnv({ PUBLIC_API_BASE_URL: undefined })
    expect(() => validateEnv()).toThrow('process.exit(1)')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PUBLIC_API_BASE_URL'))
  })

  it('PUBLIC_API_BASE_URL이 절대 URL이 아니면 process.exit(1)', () => {
    setRequiredEnv({ PUBLIC_API_BASE_URL: '/api' })
    expect(() => validateEnv()).toThrow('process.exit(1)')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('절대 URL'))
  })

  it('PUBLIC_API_BASE_URL이 https:// 절대 URL이면 통과', () => {
    setRequiredEnv({ PUBLIC_API_BASE_URL: 'https://api.grimoire-book.com/api' })
    expect(() => validateEnv()).not.toThrow()
  })

  it('DATABASE_URL 누락 시 process.exit(1)', () => {
    setRequiredEnv({ DATABASE_URL: undefined })
    expect(() => validateEnv()).toThrow('process.exit(1)')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL'))
  })

  // ── F-12 (2026-07-11): Polar 시크릿 prod 필수화 + 폐기 PAYAPP 제거 ──

  it('F-12: production 에서 POLAR_ACCESS_TOKEN 누락 시 process.exit(1)', () => {
    setRequiredEnv({
      APP_ENV: 'production',
      POLAR_ACCESS_TOKEN: undefined,
      POLAR_WEBHOOK_SECRET: 'whsec_test',
    })
    expect(() => validateEnv()).toThrow('process.exit(1)')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('POLAR_ACCESS_TOKEN'))
  })

  it('F-12: production 에서 POLAR_WEBHOOK_SECRET 누락 시 process.exit(1)', () => {
    setRequiredEnv({
      APP_ENV: 'production',
      POLAR_ACCESS_TOKEN: 'polar_test',
      POLAR_WEBHOOK_SECRET: undefined,
    })
    expect(() => validateEnv()).toThrow('process.exit(1)')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('POLAR_WEBHOOK_SECRET'))
  })

  it('F-12: production 에서 POLAR 시크릿이 모두 있으면 통과', () => {
    setRequiredEnv({
      APP_ENV: 'production',
      POLAR_ACCESS_TOKEN: 'polar_test',
      POLAR_WEBHOOK_SECRET: 'whsec_test',
    })
    expect(() => validateEnv()).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('F-12: dev/localhost 는 POLAR 시크릿 없어도 관대 — 부팅 유지 (로컬 회귀 방지)', () => {
    setRequiredEnv({
      APP_ENV: 'development',
      POLAR_ACCESS_TOKEN: undefined,
      POLAR_WEBHOOK_SECRET: undefined,
    })
    expect(() => validateEnv()).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('F-12: 폐기된 PAYAPP 그룹 제거 — "Payment disabled" 오해성 경고 미발생', () => {
    setRequiredEnv()
    validateEnv()
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Payment disabled'))
  })
})
