import { PrismaReconciliationCheckpointRepository } from './prisma-reconciliation-checkpoint.repository'

/**
 * PrismaReconciliationCheckpointRepository 단위 테스트.
 *
 * 핵심 검증:
 * - findSingleton: row 미존재 시 default seed 반환 (lastRunAt = ~24h 전)
 * - findSingleton: row 존재 시 그대로 반환
 * - update: upsert (where id='singleton', create with seed defaults)
 */
describe('PrismaReconciliationCheckpointRepository', () => {
  let repo: PrismaReconciliationCheckpointRepository
  let mockFindUnique: jest.Mock
  let mockUpsert: jest.Mock

  beforeEach(() => {
    mockFindUnique = jest.fn()
    mockUpsert = jest.fn()
    const mockPrisma = {
      reconciliationCheckpoint: {
        findUnique: mockFindUnique,
        upsert: mockUpsert,
      },
    }
    repo = new PrismaReconciliationCheckpointRepository(
      mockPrisma as unknown as ConstructorParameters<
        typeof PrismaReconciliationCheckpointRepository
      >[0],
    )
  })

  describe('findSingleton', () => {
    it('row 존재 시 그대로 반환', async () => {
      const lastRunAt = new Date('2026-05-03T10:00:00Z')
      const updatedAt = new Date('2026-05-03T10:00:01Z')
      mockFindUnique.mockResolvedValue({
        id: 'singleton',
        lastRunAt,
        processedCount: 5,
        boostCount: 1,
        mismatchCount: 0,
        expireCount: 0,
        errorMessage: null,
        updatedAt,
      })

      const result = await repo.findSingleton()

      expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 'singleton' } })
      expect(result.id).toBe('singleton')
      expect(result.lastRunAt).toEqual(lastRunAt)
      expect(result.processedCount).toBe(5)
      expect(result.boostCount).toBe(1)
    })

    it('row 미존재 시 default seed 반환 (lastRunAt ≈ 24h 전, 모든 count=0)', async () => {
      mockFindUnique.mockResolvedValue(null)
      const before = Date.now()

      const result = await repo.findSingleton()

      const after = Date.now()
      expect(result.id).toBe('singleton')
      // lastRunAt은 ~24h 전 (안전 마진: before-24h ~ after-24h+1ms 사이)
      const lastRunAtMs = result.lastRunAt.getTime()
      expect(lastRunAtMs).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 100)
      expect(lastRunAtMs).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000 + 100)
      expect(result.processedCount).toBe(0)
      expect(result.boostCount).toBe(0)
      expect(result.mismatchCount).toBe(0)
      expect(result.expireCount).toBe(0)
      expect(result.errorMessage).toBeNull()
    })
  })

  describe('update', () => {
    it('upsert를 id=singleton으로 호출하고 모든 카운터를 박제', async () => {
      const lastRunAt = new Date('2026-05-03T11:00:00Z')
      const updatedAt = new Date('2026-05-03T11:00:01Z')
      mockUpsert.mockResolvedValue({
        id: 'singleton',
        lastRunAt,
        processedCount: 10,
        boostCount: 2,
        mismatchCount: 1,
        expireCount: 1,
        errorMessage: null,
        updatedAt,
      })

      const result = await repo.update({
        lastRunAt,
        processedCount: 10,
        boostCount: 2,
        mismatchCount: 1,
        expireCount: 1,
      })

      expect(mockUpsert).toHaveBeenCalledTimes(1)
      const callArg = mockUpsert.mock.calls[0][0]
      expect(callArg.where).toEqual({ id: 'singleton' })
      expect(callArg.update).toMatchObject({
        lastRunAt,
        processedCount: 10,
        boostCount: 2,
        mismatchCount: 1,
        expireCount: 1,
        errorMessage: null,
      })
      expect(callArg.create).toMatchObject({
        id: 'singleton',
        lastRunAt,
        processedCount: 10,
      })
      expect(result.id).toBe('singleton')
      expect(result.processedCount).toBe(10)
    })

    it('errorMessage 전달 시 박제', async () => {
      const lastRunAt = new Date('2026-05-03T11:00:00Z')
      mockUpsert.mockResolvedValue({
        id: 'singleton',
        lastRunAt,
        processedCount: 0,
        boostCount: 0,
        mismatchCount: 0,
        expireCount: 0,
        errorMessage: 'polar_list_failed: rate limit',
        updatedAt: new Date(),
      })

      await repo.update({
        lastRunAt,
        processedCount: 0,
        boostCount: 0,
        mismatchCount: 0,
        expireCount: 0,
        errorMessage: 'polar_list_failed: rate limit',
      })

      const callArg = mockUpsert.mock.calls[0][0]
      expect(callArg.update.errorMessage).toBe('polar_list_failed: rate limit')
      expect(callArg.create.errorMessage).toBe('polar_list_failed: rate limit')
    })

    it('errorMessage 미전달 시 null로 박제 (기존 값 초기화)', async () => {
      mockUpsert.mockResolvedValue({
        id: 'singleton',
        lastRunAt: new Date(),
        processedCount: 0,
        boostCount: 0,
        mismatchCount: 0,
        expireCount: 0,
        errorMessage: null,
        updatedAt: new Date(),
      })

      await repo.update({
        lastRunAt: new Date(),
        processedCount: 0,
        boostCount: 0,
        mismatchCount: 0,
        expireCount: 0,
        // errorMessage 미전달
      })

      const callArg = mockUpsert.mock.calls[0][0]
      expect(callArg.update.errorMessage).toBeNull()
    })
  })
})
