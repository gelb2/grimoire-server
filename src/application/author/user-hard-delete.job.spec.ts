import { UserHardDeleteJob } from './user-hard-delete.job'

describe('UserHardDeleteJob (USER-SOFT-DELETE sprint 2026-05-15)', () => {
  let job: UserHardDeleteJob
  let mockAuthorRepo: { hardDeleteOlderThan: jest.Mock }
  let mockAuditLog: { log: jest.Mock }

  beforeEach(() => {
    mockAuthorRepo = {
      hardDeleteOlderThan: jest.fn(),
    }
    mockAuditLog = {
      log: jest.fn().mockResolvedValue(undefined),
    }
    job = new UserHardDeleteJob(mockAuthorRepo as any, mockAuditLog as any)
  })

  describe('30일 후 hard delete (cron 옵션 A 정합)', () => {
    it('30일 후 hard delete — deletedAt < 30일전 영역 deleteMany 호출', async () => {
      mockAuthorRepo.hardDeleteOlderThan.mockResolvedValue({
        deletedIds: ['author-1', 'author-2'],
        blockedIds: [],
      })

      const cutoff = new Date('2026-04-15T04:00:00Z')
      const result = await job.runHardDeletePass(cutoff)

      expect(mockAuthorRepo.hardDeleteOlderThan).toHaveBeenCalledWith(cutoff)
      expect(result.deletedIds).toEqual(['author-1', 'author-2'])
      expect(result.blockedIds).toEqual([])
    })

    it('hard delete 성공 → AdminAuditLog 30d_hard_delete 박제 (deletedIds 수만큼)', async () => {
      mockAuthorRepo.hardDeleteOlderThan.mockResolvedValue({
        deletedIds: ['author-1', 'author-2', 'author-3'],
        blockedIds: [],
      })

      await job.runHardDeletePass(new Date('2026-04-15T04:00:00Z'))

      expect(mockAuditLog.log).toHaveBeenCalledTimes(3)
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'author-1',
        '30d_hard_delete',
        'author-1',
        expect.objectContaining({ cutoff: expect.any(String), retentionDays: 30 }),
      )
    })
  })

  describe('회계 8건 P2003 차단 (옵션 A 자동 보류)', () => {
    it('회계 8건 P2003 차단 — try-catch + AdminAuditLog 30d_hard_delete_blocked 박제', async () => {
      mockAuthorRepo.hardDeleteOlderThan.mockResolvedValue({
        deletedIds: ['author-1'],
        blockedIds: ['author-2', 'author-3'],
      })

      const result = await job.runHardDeletePass(new Date())

      expect(result.deletedIds).toEqual(['author-1'])
      expect(result.blockedIds).toEqual(['author-2', 'author-3'])

      // blocked 영역 영역 영역 audit log 영역 박제 영역 영역
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'author-2',
        '30d_hard_delete_blocked',
        'author-2',
        expect.objectContaining({
          cutoff: expect.any(String),
          reason: expect.stringContaining('foreign_key_restrict'),
        }),
      )
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'author-3',
        '30d_hard_delete_blocked',
        'author-3',
        expect.any(Object),
      )
    })

    it('회계 영역 0건 — hard delete 100% 성공 + AdminAuditLog 30d_hard_delete 박제만', async () => {
      mockAuthorRepo.hardDeleteOlderThan.mockResolvedValue({
        deletedIds: ['author-1', 'author-2'],
        blockedIds: [],
      })

      await job.runHardDeletePass(new Date())

      // 30d_hard_delete 영역 영역 영역 박제 (2번) + 30d_hard_delete_blocked 영역 영역 영역 0건
      const calls = mockAuditLog.log.mock.calls
      const deleteActions = calls.filter((c) => c[1] === '30d_hard_delete')
      const blockedActions = calls.filter((c) => c[1] === '30d_hard_delete_blocked')

      expect(deleteActions).toHaveLength(2)
      expect(blockedActions).toHaveLength(0)
    })
  })

  describe('동시 실행 차단 + 비활성화 게이트', () => {
    it('USER_HARD_DELETE_DISABLED=1 영역 영역 영역 영역 영역 (skip)', async () => {
      const originalEnv = process.env.USER_HARD_DELETE_DISABLED
      process.env.USER_HARD_DELETE_DISABLED = '1'

      try {
        await job.hardDeleteExpiredUsers()
        // 영역 영역 영역 영역 영역 영역 영역 0건 강제
        expect(mockAuthorRepo.hardDeleteOlderThan).not.toHaveBeenCalled()
      } finally {
        if (originalEnv === undefined) {
          delete process.env.USER_HARD_DELETE_DISABLED
        } else {
          process.env.USER_HARD_DELETE_DISABLED = originalEnv
        }
      }
    })
  })
})
