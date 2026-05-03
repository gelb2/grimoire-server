import { Prisma } from '@prisma/client'
import { PrismaWebhookEventRepository } from './prisma-webhook-event.repository'

/**
 * PrismaWebhookEventRepository 단위 테스트.
 *
 * 핵심 검증:
 * - findByEventId: 정상 조회 + 미발견 시 null
 * - createIfAbsent: 정상 INSERT + P2002 race 시 null 반환 (예외 throw 금지)
 * - markStatus: status 갱신
 *
 * Sprint: PAY-P0-1 (2026-05-03)
 */
describe('PrismaWebhookEventRepository', () => {
  let repo: PrismaWebhookEventRepository
  let mockPrisma: any

  const fixedDate = new Date('2026-05-03T14:34:03.000Z')
  const sampleRow = {
    id: 'whe-1',
    eventId: 'msg_polar_001',
    source: 'polar',
    eventType: 'order.paid',
    payload: { foo: 'bar' },
    status: 'processed',
    errorMessage: null,
    processedAt: fixedDate,
  }

  beforeEach(() => {
    mockPrisma = {
      webhookEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    }
    repo = new PrismaWebhookEventRepository(mockPrisma)
  })

  describe('findByEventId', () => {
    it('eventId로 record를 발견하면 도메인 객체를 반환한다', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(sampleRow)

      const result = await repo.findByEventId('msg_polar_001')

      expect(mockPrisma.webhookEvent.findUnique).toHaveBeenCalledWith({
        where: { eventId: 'msg_polar_001' },
      })
      expect(result).toEqual({
        id: 'whe-1',
        eventId: 'msg_polar_001',
        source: 'polar',
        eventType: 'order.paid',
        status: 'processed',
        processedAt: fixedDate,
      })
    })

    it('미발견 시 null 반환', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(null)

      const result = await repo.findByEventId('msg_unknown')

      expect(result).toBeNull()
    })
  })

  describe('createIfAbsent', () => {
    it('정상 INSERT 시 도메인 객체를 반환한다', async () => {
      mockPrisma.webhookEvent.create.mockResolvedValueOnce(sampleRow)

      const result = await repo.createIfAbsent({
        eventId: 'msg_polar_001',
        source: 'polar',
        eventType: 'order.paid',
        payload: { foo: 'bar' },
        status: 'processed',
      })

      expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith({
        data: {
          eventId: 'msg_polar_001',
          source: 'polar',
          eventType: 'order.paid',
          payload: { foo: 'bar' },
          status: 'processed',
          errorMessage: null,
        },
      })
      expect(result?.eventId).toBe('msg_polar_001')
      expect(result?.status).toBe('processed')
    })

    it('PAY-P0-1: P2002 unique 제약 위반 시 null 반환 (예외 throw 금지, race 안전)', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`event_id`)',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['event_id'] },
        },
      )
      mockPrisma.webhookEvent.create.mockRejectedValueOnce(p2002Error)

      const result = await repo.createIfAbsent({
        eventId: 'msg_polar_002',
        source: 'polar',
        eventType: 'order.paid',
        payload: { foo: 'bar' },
      })

      expect(result).toBeNull()
    })

    it('P2002 외 예외는 그대로 throw한다', async () => {
      const otherError = new Error('database connection lost')
      mockPrisma.webhookEvent.create.mockRejectedValueOnce(otherError)

      await expect(
        repo.createIfAbsent({
          eventId: 'msg_polar_003',
          source: 'polar',
          eventType: 'order.paid',
          payload: {},
        }),
      ).rejects.toThrow('database connection lost')
    })

    it('status 미지정 시 기본값 processed로 INSERT', async () => {
      mockPrisma.webhookEvent.create.mockResolvedValueOnce(sampleRow)

      await repo.createIfAbsent({
        eventId: 'msg_polar_004',
        source: 'polar',
        eventType: 'order.refunded',
        payload: {},
      })

      expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'processed' }),
        }),
      )
    })

    it('errorMessage 박제 시 INSERT data에 포함', async () => {
      mockPrisma.webhookEvent.create.mockResolvedValueOnce({
        ...sampleRow,
        status: 'failed',
        errorMessage: 'unknown_trade',
      })

      await repo.createIfAbsent({
        eventId: 'msg_polar_005',
        source: 'polar',
        eventType: 'order.paid',
        payload: {},
        status: 'failed',
        errorMessage: 'unknown_trade',
      })

      expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            errorMessage: 'unknown_trade',
          }),
        }),
      )
    })
  })

  describe('markStatus', () => {
    it('eventId로 status 갱신', async () => {
      mockPrisma.webhookEvent.update.mockResolvedValueOnce(undefined)

      await repo.markStatus('msg_polar_001', 'failed', 'retry exceeded')

      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
        where: { eventId: 'msg_polar_001' },
        data: { status: 'failed', errorMessage: 'retry exceeded' },
      })
    })

    it('errorMessage 미지정 시 null 박제', async () => {
      mockPrisma.webhookEvent.update.mockResolvedValueOnce(undefined)

      await repo.markStatus('msg_polar_001', 'processed')

      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
        where: { eventId: 'msg_polar_001' },
        data: { status: 'processed', errorMessage: null },
      })
    })
  })
})
