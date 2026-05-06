import { AuditLogService } from './audit-log.service'

/**
 * AuditLogService spec — Sprint PAY-P2-4 (2026-05-06).
 *
 * 검증 영역:
 * 1. log() 4-arg 호출 BACKWARD COMPATIBILITY (beforeState/afterState 키 미박제)
 * 2. log() 6-arg 호출 (beforeState 박제)
 * 3. log() 7-arg 호출 (beforeState + afterState 동시 박제)
 * 4. detail undefined + state 박제 동작
 * 5. 키 누설 차단 (afterState undefined 시 키 미박제)
 * 6. findAll() 위임 검증
 *
 * 정본: `.claude/shared-contracts.md` §20 AdminAuditLog beforeState/afterState Convention
 */
describe('AuditLogService', () => {
  let service: AuditLogService
  let mockAuditLogRepo: {
    create: jest.Mock
    findAll: jest.Mock
  }

  beforeEach(() => {
    mockAuditLogRepo = {
      create: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    }
    service = new AuditLogService(mockAuditLogRepo as never)
  })

  describe('log() — BACKWARD COMPATIBILITY (PAY-P2-4)', () => {
    it('4-arg 호출 시 detail JSON에 beforeState/afterState 키 미박제 (회귀 0건)', async () => {
      await service.log('admin-1', 'author_update', 'author-1', { foo: 'bar' })

      // create는 정확히 1회 + 4-arg 그대로 위임 (beforeState/afterState 키 미박제)
      expect(mockAuditLogRepo.create).toHaveBeenCalledTimes(1)
      expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
        'admin-1',
        'author_update',
        'author-1',
        { foo: 'bar' },
      )

      // 키 누설 차단 검증 — detail JSON에 beforeState/afterState 키가 박제되지 않아야 함
      const detailArg = mockAuditLogRepo.create.mock.calls[0][3] as Record<string, unknown>
      expect(detailArg).not.toHaveProperty('beforeState')
      expect(detailArg).not.toHaveProperty('afterState')
    })

    it('detail undefined + state 모두 undefined 시 detail은 undefined로 위임 (회귀 0건)', async () => {
      await service.log('admin-1', 'simple_action', 'target-1')

      expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
        'admin-1',
        'simple_action',
        'target-1',
        undefined,
      )
    })
  })

  describe('log() — 6-arg 호출 (beforeState만 박제)', () => {
    it('detail + beforeState 박제 시 detail JSON에 beforeState 키 추가', async () => {
      await service.log(
        'admin-1',
        'credit_grant',
        'author-1',
        { amount: 50, reason: '프로모션' },
        { credits: 100 },
      )

      expect(mockAuditLogRepo.create).toHaveBeenCalledTimes(1)
      // toEqual 정밀 검증 — detail JSON 정확 일치
      expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
        'admin-1',
        'credit_grant',
        'author-1',
        {
          amount: 50,
          reason: '프로모션',
          beforeState: { credits: 100 },
        },
      )

      // 키 누설 차단 — afterState 키는 박제되지 않아야 함
      const detailArg = mockAuditLogRepo.create.mock.calls[0][3] as Record<string, unknown>
      expect(detailArg).not.toHaveProperty('afterState')
    })
  })

  describe('log() — 7-arg 호출 (beforeState + afterState 동시 박제)', () => {
    it('detail + before + after 박제 시 detail JSON에 두 키 모두 추가 (PAY-P2-4 정본 흐름)', async () => {
      await service.log(
        'admin-1',
        'credit_grant',
        'author-1',
        { amount: 50, reason: '프로모션' },
        { credits: 100 },
        { credits: 150 },
      )

      // toEqual 정밀 검증
      expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
        'admin-1',
        'credit_grant',
        'author-1',
        {
          amount: 50,
          reason: '프로모션',
          beforeState: { credits: 100 },
          afterState: { credits: 150 },
        },
      )
    })

    it('payment_completed 시나리오 — afterState에 paymentId/addedCredits 박제', async () => {
      await service.log(
        'system_payment',
        'payment_completed',
        'pay-1',
        { reason: 'polar_webhook_order.completed', externalTransactionId: 'TRADE-001' },
        { credits: 50 },
        { credits: 150, paymentId: 'pay-1', addedCredits: 100 },
      )

      // toMatchObject — afterState의 추가 필드 검증
      expect(mockAuditLogRepo.create.mock.calls[0][3]).toMatchObject({
        reason: 'polar_webhook_order.completed',
        externalTransactionId: 'TRADE-001',
        beforeState: { credits: 50 },
        afterState: {
          credits: 150,
          paymentId: 'pay-1',
          addedCredits: 100,
        },
      })
    })
  })

  describe('log() — detail undefined + state 박제', () => {
    it('detail undefined + before/after 박제 시 detail JSON에 두 키만 박제', async () => {
      await service.log(
        'admin-1',
        'role_change',
        'author-1',
        undefined,
        { role: 'user' },
        { role: 'admin' },
      )

      expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
        'admin-1',
        'role_change',
        'author-1',
        {
          beforeState: { role: 'user' },
          afterState: { role: 'admin' },
        },
      )
    })
  })

  describe('log() — 키 누설 차단 (afterState undefined)', () => {
    it('beforeState만 박제 + afterState undefined 시 detail JSON에 afterState 키 미박제', async () => {
      await service.log(
        'admin-1',
        'sanction_check',
        'author-1',
        { type: 'warning' },
        { credits: 100 },
        undefined,
      )

      // beforeState 박제
      expect(mockAuditLogRepo.create.mock.calls[0][3]).toEqual({
        type: 'warning',
        beforeState: { credits: 100 },
      })

      // 키 누설 차단 — afterState 키는 detail JSON에 박제되지 않아야 함
      const detailArg = mockAuditLogRepo.create.mock.calls[0][3] as Record<string, unknown>
      expect(detailArg).not.toHaveProperty('afterState')
    })

    it('afterState만 박제 + beforeState undefined 시 detail JSON에 beforeState 키 미박제', async () => {
      await service.log(
        'admin-1',
        'announce_create',
        'ann-1',
        { title: '신규 공지' },
        undefined,
        { credits: 0, status: 'published' },
      )

      // afterState 박제
      expect(mockAuditLogRepo.create.mock.calls[0][3]).toEqual({
        title: '신규 공지',
        afterState: { credits: 0, status: 'published' },
      })

      // 키 누설 차단 — beforeState 키는 detail JSON에 박제되지 않아야 함
      const detailArg = mockAuditLogRepo.create.mock.calls[0][3] as Record<string, unknown>
      expect(detailArg).not.toHaveProperty('beforeState')
    })
  })

  describe('findAll() 위임', () => {
    it('options를 그대로 repository에 위임', async () => {
      const options = { page: 2, limit: 50, action: 'credit_grant' }
      const result = await service.findAll(options)

      expect(mockAuditLogRepo.findAll).toHaveBeenCalledTimes(1)
      expect(mockAuditLogRepo.findAll).toHaveBeenCalledWith(options)
      expect(result).toEqual({ items: [], total: 0 })
    })

    it('options 미지정 시 빈 객체로 위임 (default)', async () => {
      await service.findAll()

      expect(mockAuditLogRepo.findAll).toHaveBeenCalledWith({})
    })
  })
})
