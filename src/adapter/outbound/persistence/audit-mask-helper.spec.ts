import {
  PII_KEYS,
  PRESERVED_KEYS,
  maskEmail,
  maskPhone,
  maskIpAddress,
  maskUserAgent,
  maskSecret,
  maskValueByKey,
  maskJsonDeep,
  maskAccessLogRow,
} from './audit-mask-helper'

/**
 * Sprint PAY-P2-5 — audit-mask-helper 테스트.
 *
 * 사용자 결정 옵션 D (5/10): 영구 보존 + 90일 후 PII 마스킹.
 * 정본: `.claude/shared-contracts.md` §26 AuditRetentionPolicy
 */
describe('audit-mask-helper', () => {
  describe('PII_KEYS 매트릭스', () => {
    it('PII 7 키 정합', () => {
      expect(PII_KEYS).toEqual([
        'email',
        'phone',
        'ipAddress',
        'userAgent',
        'passwordHash',
        'token',
        'secret',
      ])
    })
  })

  describe('PRESERVED_KEYS 매트릭스 (audit 본질 보존)', () => {
    it('id / userId / authorId / adminId / action / createdAt 보존 키 정합', () => {
      expect(PRESERVED_KEYS.has('id')).toBe(true)
      expect(PRESERVED_KEYS.has('userId')).toBe(true)
      expect(PRESERVED_KEYS.has('authorId')).toBe(true)
      expect(PRESERVED_KEYS.has('adminId')).toBe(true)
      expect(PRESERVED_KEYS.has('action')).toBe(true)
      expect(PRESERVED_KEYS.has('createdAt')).toBe(true)
    })

    it('snake_case 변형도 보존', () => {
      expect(PRESERVED_KEYS.has('user_id')).toBe(true)
      expect(PRESERVED_KEYS.has('author_id')).toBe(true)
      expect(PRESERVED_KEYS.has('admin_id')).toBe(true)
      expect(PRESERVED_KEYS.has('created_at')).toBe(true)
    })
  })

  describe('maskEmail', () => {
    it('john@example.com → j***@example.com', () => {
      expect(maskEmail('john@example.com')).toBe('j***@example.com')
    })

    it('a@b.com → a***@b.com', () => {
      expect(maskEmail('a@b.com')).toBe('a***@b.com')
    })

    it('@만 있는 이상한 값 → ***', () => {
      expect(maskEmail('@example.com')).toBe('***')
    })

    it('이미 마스킹된 값 멱등성 (재마스킹 X)', () => {
      expect(maskEmail('j***@example.com')).toBe('j***@example.com')
    })
  })

  describe('maskPhone', () => {
    it('010-1234-5678 → 010-****-****', () => {
      expect(maskPhone('010-1234-5678')).toBe('010-****-****')
    })

    it('01012345678 → 010-****-****', () => {
      expect(maskPhone('01012345678')).toBe('010-****-****')
    })

    it('짧은 값 → ***', () => {
      expect(maskPhone('123')).toBe('***')
    })

    it('이미 마스킹된 값 멱등성', () => {
      expect(maskPhone('010-****-****')).toBe('010-****-****')
    })
  })

  describe('maskIpAddress', () => {
    it('192.168.1.100 → 192.168.***.**', () => {
      expect(maskIpAddress('192.168.1.100')).toBe('192.168.***.**')
    })

    it('IPv4 형식 아닌 값 → ***', () => {
      expect(maskIpAddress('not-an-ip')).toBe('***')
    })

    it('이미 마스킹된 값 멱등성', () => {
      expect(maskIpAddress('192.168.***.**')).toBe('192.168.***.**')
    })
  })

  describe('maskUserAgent', () => {
    it('Mozilla/5.0 (...) → Mozilla/5.0 (***)', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      expect(maskUserAgent(ua)).toBe('Mozilla/5.0 (***)')
    })

    it('패턴 매칭 X → ***', () => {
      expect(maskUserAgent('curl')).toBe('***')
    })
  })

  describe('maskSecret', () => {
    it('모든 값 → ***', () => {
      expect(maskSecret('any-secret-value')).toBe('***')
      expect(maskSecret('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx')).toBe('***')
    })
  })

  describe('maskValueByKey', () => {
    it('email 키 → 이메일 마스킹', () => {
      expect(maskValueByKey('email', 'john@example.com')).toBe('j***@example.com')
    })

    it('user_email 키 → 이메일 마스킹', () => {
      expect(maskValueByKey('user_email', 'john@example.com')).toBe('j***@example.com')
    })

    it('ipAddress 키 → IP 마스킹', () => {
      expect(maskValueByKey('ipAddress', '192.168.1.100')).toBe('192.168.***.**')
    })

    it('ip 키 → IP 마스킹', () => {
      expect(maskValueByKey('ip', '192.168.1.100')).toBe('192.168.***.**')
    })

    it('userAgent 키 → UA 마스킹', () => {
      expect(maskValueByKey('userAgent', 'Mozilla/5.0 (Macintosh)')).toBe('Mozilla/5.0 (***)')
    })

    it('token 키 → secret 마스킹', () => {
      expect(maskValueByKey('token', 'eyJxxx.yyy.zzz')).toBe('***')
    })

    it('access_token 키 → secret 마스킹', () => {
      expect(maskValueByKey('access_token', 'sk-xxx')).toBe('***')
    })

    it('id 키 (보존) → 마스킹 X', () => {
      expect(maskValueByKey('id', 'abc-123')).toBe('abc-123')
    })

    it('authorId 키 (보존) → 마스킹 X', () => {
      expect(maskValueByKey('authorId', 'author-uuid')).toBe('author-uuid')
    })

    it('createdAt 키 (보존) → 마스킹 X', () => {
      expect(maskValueByKey('createdAt', '2026-01-01T00:00:00Z')).toBe('2026-01-01T00:00:00Z')
    })

    it('amount 키 (보존, 숫자) → 마스킹 X', () => {
      expect(maskValueByKey('amount', 1000)).toBe(1000)
    })

    it('알려지지 않은 키 → 그대로', () => {
      expect(maskValueByKey('foo', 'bar')).toBe('bar')
    })
  })

  describe('maskJsonDeep', () => {
    it('단일 객체 PII 키 마스킹', () => {
      const input = {
        email: 'john@example.com',
        ip: '192.168.1.100',
        userId: 'user-123',
        action: 'login',
      }
      const result = maskJsonDeep(input) as Record<string, unknown>
      expect(result.email).toBe('j***@example.com')
      expect(result.ip).toBe('192.168.***.**')
      expect(result.userId).toBe('user-123') // 보존
      expect(result.action).toBe('login') // 보존
    })

    it('중첩 객체 재귀 마스킹', () => {
      const input = {
        userId: 'user-123',
        meta: {
          email: 'john@example.com',
          phone: '010-1234-5678',
          createdAt: '2026-01-01',
        },
      }
      const result = maskJsonDeep(input) as Record<string, unknown>
      const meta = result.meta as Record<string, unknown>
      expect(result.userId).toBe('user-123')
      expect(meta.email).toBe('j***@example.com')
      expect(meta.phone).toBe('010-****-****')
      expect(meta.createdAt).toBe('2026-01-01') // 보존
    })

    it('배열 재귀 마스킹', () => {
      const input = {
        items: [
          { email: 'a@example.com', action: 'click' },
          { email: 'b@example.com', action: 'view' },
        ],
      }
      const result = maskJsonDeep(input) as Record<string, unknown>
      const items = result.items as Array<Record<string, unknown>>
      expect(items[0].email).toBe('a***@example.com')
      expect(items[0].action).toBe('click')
      expect(items[1].email).toBe('b***@example.com')
      expect(items[1].action).toBe('view')
    })

    it('null / undefined 안전', () => {
      expect(maskJsonDeep(null)).toBe(null)
      expect(maskJsonDeep(undefined)).toBe(undefined)
    })

    it('이미 마스킹된 값 멱등성', () => {
      const input = { email: 'j***@example.com', ip: '192.168.***.**' }
      const result = maskJsonDeep(input) as Record<string, unknown>
      expect(result.email).toBe('j***@example.com')
      expect(result.ip).toBe('192.168.***.**')
    })
  })

  describe('maskAccessLogRow', () => {
    it('4 컬럼 마스킹 (email/ip/userAgent/detail)', () => {
      const result = maskAccessLogRow({
        email: 'john@example.com',
        ip: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Macintosh)',
        detail: 'free-form text',
      })
      expect(result.email).toBe('j***@example.com')
      expect(result.ip).toBe('192.168.***.**')
      expect(result.userAgent).toBe('Mozilla/5.0 (***)')
      expect(result.detail).toBe('free-form text') // string 자유 형식 보존
    })

    it('null 값 안전', () => {
      const result = maskAccessLogRow({
        email: null,
        ip: null,
        userAgent: null,
        detail: null,
      })
      expect(result.email).toBeNull()
      expect(result.ip).toBeNull()
      expect(result.userAgent).toBeNull()
      expect(result.detail).toBeNull()
    })
  })
})
