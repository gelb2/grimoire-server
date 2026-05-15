import { AuditMaskJob } from './audit-mask.job'
import type { PrismaService } from '@infrastructure/prisma/prisma.service'

/**
 * Sprint PAY-P2-5 — AuditMaskJob 테스트.
 *
 * 사용자 결정 옵션 D (5/10): 영구 보존 + 90일 후 PII 마스킹.
 * 정본: `.claude/shared-contracts.md` §26 AuditRetentionPolicy
 */
describe('AuditMaskJob', () => {
  function buildPrismaMock(): jest.Mocked<PrismaService> {
    const adminFindMany = jest.fn()
    const adminUpdate = jest.fn()
    const webhookFindMany = jest.fn()
    const webhookUpdate = jest.fn()
    const retryFindMany = jest.fn()
    const retryUpdate = jest.fn()
    const accessFindMany = jest.fn()
    const accessUpdate = jest.fn()
    return {
      adminAuditLog: { findMany: adminFindMany, update: adminUpdate },
      webhookEvent: { findMany: webhookFindMany, update: webhookUpdate },
      webhookRetryQueue: { findMany: retryFindMany, update: retryUpdate },
      accessLog: { findMany: accessFindMany, update: accessUpdate },
    } as unknown as jest.Mocked<PrismaService>
  }

  describe('runMaskingPass — 90일 경과 row 0건 (시나리오 A, dev 5/10 정합)', () => {
    it('4 모델 모두 0건 시 noop 정합 (DELETE 호출 0건)', async () => {
      const prisma = buildPrismaMock()
      ;(prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.webhookEvent.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.webhookRetryQueue.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.accessLog.findMany as jest.Mock).mockResolvedValue([])

      const job = new AuditMaskJob(prisma)
      const cutoff = new Date('2026-02-09T00:00:00Z')
      const result = await job.runMaskingPass(cutoff)

      expect(result.modelsProcessed).toEqual([
        'admin_audit_logs',
        'webhook_events',
        'webhook_retry_queues',
        'access_logs',
      ])
      expect(result.rowsMasked).toBe(0)
      expect(result.rowsSkipped).toBe(0)
      expect(result.errors).toEqual([])
      // DELETE 0건 강제 — update만 호출
      expect(prisma.adminAuditLog.update).not.toHaveBeenCalled()
    })
  })

  describe('runMaskingPass — AdminAuditLog detail JSON deep masking', () => {
    it('PII 키 마스킹 + 보존 키 정합 + maskedAt + retentionTier 갱신', async () => {
      const prisma = buildPrismaMock()
      ;(prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'admin-log-1',
          detail: {
            email: 'john@example.com',
            authorId: 'author-123', // 보존
            action: 'credit_grant', // 보존 (그러나 detail 영역 키)
          },
        },
      ])
      ;(prisma.adminAuditLog.update as jest.Mock).mockResolvedValue({})
      ;(prisma.webhookEvent.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.webhookRetryQueue.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.accessLog.findMany as jest.Mock).mockResolvedValue([])

      const job = new AuditMaskJob(prisma)
      const result = await job.runMaskingPass(new Date('2026-02-09T00:00:00Z'))

      expect(result.rowsMasked).toBe(1)
      expect(prisma.adminAuditLog.update).toHaveBeenCalledTimes(1)
      const updateCall = (prisma.adminAuditLog.update as jest.Mock).mock.calls[0][0]
      expect(updateCall.where).toEqual({ id: 'admin-log-1' })
      expect(updateCall.data.retentionTier).toBe('masked')
      expect(updateCall.data.maskedAt).toBeInstanceOf(Date)
      const maskedDetail = updateCall.data.detail as Record<string, unknown>
      expect(maskedDetail.email).toBe('j***@example.com')
      expect(maskedDetail.authorId).toBe('author-123') // 보존
      expect(maskedDetail.action).toBe('credit_grant') // 보존
    })
  })

  describe('runMaskingPass — AccessLog 4 컬럼 마스킹', () => {
    it('email/ip/userAgent 마스킹 + detail 보존', async () => {
      const prisma = buildPrismaMock()
      ;(prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.webhookEvent.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.webhookRetryQueue.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.accessLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'access-1',
          email: 'john@example.com',
          ip: '192.168.1.100',
          userAgent: 'Mozilla/5.0 (Macintosh)',
          detail: 'free-form fail reason',
        },
      ])
      ;(prisma.accessLog.update as jest.Mock).mockResolvedValue({})

      const job = new AuditMaskJob(prisma)
      const result = await job.runMaskingPass(new Date('2026-02-09T00:00:00Z'))

      expect(result.rowsMasked).toBe(1)
      const updateCall = (prisma.accessLog.update as jest.Mock).mock.calls[0][0]
      expect(updateCall.data.email).toBe('j***@example.com')
      expect(updateCall.data.ip).toBe('192.168.***.**')
      expect(updateCall.data.userAgent).toBe('Mozilla/5.0 (***)')
      expect(updateCall.data.detail).toBe('free-form fail reason') // string 자유 형식 보존
      expect(updateCall.data.retentionTier).toBe('masked')
      expect(updateCall.data.maskedAt).toBeInstanceOf(Date)
    })
  })

  describe('runMaskingPass — 멱등성 (WHERE retentionTier=active 정합)', () => {
    it('이미 masked row는 findMany WHERE 영역에서 제외 (재마스킹 0건)', async () => {
      const prisma = buildPrismaMock()
      ;(prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.webhookEvent.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.webhookRetryQueue.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.accessLog.findMany as jest.Mock).mockResolvedValue([])

      const job = new AuditMaskJob(prisma)
      await job.runMaskingPass(new Date('2026-02-09T00:00:00Z'))

      // 4 모델 모두 retentionTier='active' WHERE 정합
      const adminFindCall = (prisma.adminAuditLog.findMany as jest.Mock).mock.calls[0][0]
      expect(adminFindCall.where.retentionTier).toBe('active')
      const webhookFindCall = (prisma.webhookEvent.findMany as jest.Mock).mock.calls[0][0]
      expect(webhookFindCall.where.retentionTier).toBe('active')
      const retryFindCall = (prisma.webhookRetryQueue.findMany as jest.Mock).mock.calls[0][0]
      expect(retryFindCall.where.retentionTier).toBe('active')
      const accessFindCall = (prisma.accessLog.findMany as jest.Mock).mock.calls[0][0]
      expect(accessFindCall.where.retentionTier).toBe('active')
    })
  })

  describe('runMaskingPass — 단일 row 실패 시 다른 row 영향 0건', () => {
    it('row 1 실패 / row 2 성공 시 rowsMasked=1 + errors=1', async () => {
      const prisma = buildPrismaMock()
      ;(prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue([
        { id: 'fail-row', detail: { email: 'a@b.com' } },
        { id: 'ok-row', detail: { email: 'c@d.com' } },
      ])
      ;(prisma.adminAuditLog.update as jest.Mock)
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValueOnce({})
      ;(prisma.webhookEvent.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.webhookRetryQueue.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.accessLog.findMany as jest.Mock).mockResolvedValue([])

      const job = new AuditMaskJob(prisma)
      const result = await job.runMaskingPass(new Date('2026-02-09T00:00:00Z'))

      expect(result.rowsMasked).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].rowId).toBe('fail-row')
      expect(result.errors[0].error).toBe('DB connection lost')
    })
  })

  describe('maskExpiredAuditRows cron — 비활성화 게이트', () => {
    it('AUDIT_MASK_DISABLED=1 시 즉시 return + DB 호출 0건', async () => {
      const prisma = buildPrismaMock()
      const job = new AuditMaskJob(prisma)
      const original = process.env.AUDIT_MASK_DISABLED
      process.env.AUDIT_MASK_DISABLED = '1'
      try {
        await job.maskExpiredAuditRows()
        expect(prisma.adminAuditLog.findMany).not.toHaveBeenCalled()
      } finally {
        if (original === undefined) {
          delete process.env.AUDIT_MASK_DISABLED
        } else {
          process.env.AUDIT_MASK_DISABLED = original
        }
      }
    })
  })
})
