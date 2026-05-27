import {
  TOKEN_EXPIRE_MINUTES,
  calculateExpireAt,
  generatePlainToken,
  hashToken,
  isTokenUsable,
} from './email-verification-token'

describe('email-verification-token domain model', () => {
  describe('generatePlainToken', () => {
    it('32바이트 base64url 토큰 생성 (43자 + padding 없음)', () => {
      const token = generatePlainToken()
      // base64url(32 bytes) = 43 chars 무패딩
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    })

    it('각 호출마다 다른 토큰 생성', () => {
      const t1 = generatePlainToken()
      const t2 = generatePlainToken()
      expect(t1).not.toBe(t2)
    })
  })

  describe('hashToken', () => {
    it('동일 평문 + 동일 pepper 시 동일 hash 반환', () => {
      process.env.EMAIL_TOKEN_PEPPER = 'test-pepper-1'
      const plain = 'abc123token'
      expect(hashToken(plain)).toBe(hashToken(plain))
      delete process.env.EMAIL_TOKEN_PEPPER
    })

    it('pepper 변경 시 다른 hash 반환', () => {
      process.env.EMAIL_TOKEN_PEPPER = 'pepper-a'
      const hashA = hashToken('same-token')
      process.env.EMAIL_TOKEN_PEPPER = 'pepper-b'
      const hashB = hashToken('same-token')
      expect(hashA).not.toBe(hashB)
      delete process.env.EMAIL_TOKEN_PEPPER
    })

    it('sha256 hash 길이 = 64자 hex', () => {
      const hash = hashToken('abc')
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('calculateExpireAt', () => {
    it('verify_email = 발급+60분', () => {
      const issued = new Date('2026-05-27T12:00:00Z')
      const expire = calculateExpireAt('verify_email', issued)
      expect(expire.getTime() - issued.getTime()).toBe(60 * 60 * 1000)
    })

    it('password_reset = 발급+30분', () => {
      const issued = new Date('2026-05-27T12:00:00Z')
      const expire = calculateExpireAt('password_reset', issued)
      expect(expire.getTime() - issued.getTime()).toBe(30 * 60 * 1000)
    })

    it('TOKEN_EXPIRE_MINUTES 단일 정본 — verify_email=60 / password_reset=30', () => {
      expect(TOKEN_EXPIRE_MINUTES.verify_email).toBe(60)
      expect(TOKEN_EXPIRE_MINUTES.password_reset).toBe(30)
    })
  })

  describe('isTokenUsable', () => {
    const now = new Date('2026-05-27T12:00:00Z')

    it('미만료 + 미사용 토큰 → usable=true', () => {
      const result = isTokenUsable(
        {
          expireAt: new Date('2026-05-27T13:00:00Z'),
          redeemedAt: null,
        },
        now,
      )
      expect(result.usable).toBe(true)
    })

    it('만료 토큰 → usable=false, reason="expired"', () => {
      const result = isTokenUsable(
        {
          expireAt: new Date('2026-05-27T11:00:00Z'),
          redeemedAt: null,
        },
        now,
      )
      expect(result.usable).toBe(false)
      expect(result.reason).toBe('expired')
    })

    it('이미 사용된 토큰 → usable=false, reason="redeemed" (재사용 차단)', () => {
      const result = isTokenUsable(
        {
          expireAt: new Date('2026-05-27T13:00:00Z'),
          redeemedAt: new Date('2026-05-27T12:30:00Z'),
        },
        now,
      )
      expect(result.usable).toBe(false)
      expect(result.reason).toBe('redeemed')
    })

    it('만료 + 이미 사용 동시 → redeemed 우선 (보안 메시지 일관성)', () => {
      const result = isTokenUsable(
        {
          expireAt: new Date('2026-05-27T11:00:00Z'),
          redeemedAt: new Date('2026-05-27T11:30:00Z'),
        },
        now,
      )
      expect(result.usable).toBe(false)
      expect(result.reason).toBe('redeemed')
    })
  })
})
