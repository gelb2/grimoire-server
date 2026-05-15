import { DefaultUserAnonymizerAdapter } from './default-user-anonymizer.adapter'

describe('DefaultUserAnonymizerAdapter (USER-SOFT-DELETE sprint 2026-05-15)', () => {
  let mockPrisma: { $executeRaw: jest.Mock }
  let adapter: DefaultUserAnonymizerAdapter
  let capturedSql: any[]
  let capturedValues: any[]

  beforeEach(() => {
    capturedSql = []
    capturedValues = []
    mockPrisma = {
      $executeRaw: jest.fn().mockImplementation((strings: TemplateStringsArray, ...values: any[]) => {
        capturedSql.push(strings.raw.join('?'))
        capturedValues.push(values)
        return Promise.resolve(1)
      }),
    }
    adapter = new DefaultUserAnonymizerAdapter(mockPrisma as any)
  })

  describe('옵션 A (basic) — 기본 익명화', () => {
    it('이메일 anonymize — anonymized-{uuid}@deleted.local 정합', async () => {
      await adapter.anonymize('author-1', 'basic')

      expect(mockPrisma.$executeRaw).toHaveBeenCalled()
      // 첫 번째 호출 — authors 영역 UPDATE
      const sql = capturedSql[0]
      expect(sql).toContain('UPDATE "authors"')
      expect(sql).toContain('"email"')
      // values 영역 영역 이메일 영역 anonymized 영역 확인
      const emailValue = capturedValues[0][0] // 첫 번째 ${anonymizedEmail}
      expect(emailValue).toMatch(/^anonymized-[a-f0-9-]+@deleted\.local$/)
    })

    it('이름 anonymize — Deleted Author 정합', async () => {
      await adapter.anonymize('author-1', 'basic')

      const nameValue = capturedValues[0][1] // 두 번째 ${anonymizedName}
      expect(nameValue).toBe('Deleted Author')
    })

    it('passwordHash + bio NULL — 재로그인 차단 + 식별 영역 영역', async () => {
      await adapter.anonymize('author-1', 'basic')

      const sql = capturedSql[0]
      expect(sql).toContain('"password_hash" = NULL')
      expect(sql).toContain('"bio" = NULL')
    })
  })

  describe('옵션 B (strong) — IP/userAgent anonymize', () => {
    it('access_logs IP/userAgent → NULL', async () => {
      await adapter.anonymize('author-1', 'strong')

      // 2번 호출 — authors UPDATE + access_logs UPDATE
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2)
      const accessLogSql = capturedSql[1]
      expect(accessLogSql).toContain('UPDATE "access_logs"')
      expect(accessLogSql).toContain('"ip" = NULL')
      expect(accessLogSql).toContain('"user_agent" = NULL')
    })
  })

  describe('UUID 영역 영역 영역 영역 영역 영역', () => {
    it('두 번 호출 영역 영역 영역 영역 다른 uuid 영역 (충돌 영역 0건)', async () => {
      await adapter.anonymize('author-1', 'basic')
      await adapter.anonymize('author-2', 'basic')

      const email1 = capturedValues[0][0]
      const email2 = capturedValues[1][0]
      expect(email1).not.toEqual(email2)
    })
  })
})
