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
})
