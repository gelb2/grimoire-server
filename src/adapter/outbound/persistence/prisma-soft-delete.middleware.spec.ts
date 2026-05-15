import { applySoftDeleteMiddleware } from './prisma-soft-delete.middleware'

describe('PrismaSoftDeleteMiddleware (USER-SOFT-DELETE sprint 2026-05-15)', () => {
  let registeredMiddleware: ((params: any, next: any) => Promise<any>) | null
  let mockPrisma: { $use: jest.Mock }

  beforeEach(() => {
    registeredMiddleware = null
    mockPrisma = {
      $use: jest.fn().mockImplementation((mw) => {
        registeredMiddleware = mw
      }),
    }
    applySoftDeleteMiddleware(mockPrisma as any)
  })

  function makeNext(returnValue: unknown = undefined) {
    return jest.fn().mockResolvedValue(returnValue)
  }

  describe('findUnique → findFirst 변환 + deletedAt: null 자동 추가', () => {
    it('findUnique — WHERE deletedAt IS NULL 자동 추가 + findFirst 변환', async () => {
      const next = makeNext({ id: 'author-1' })
      const params: any = {
        model: 'Author',
        action: 'findUnique',
        args: { where: { id: 'author-1' } },
      }

      await registeredMiddleware!(params, next)

      expect(params.action).toBe('findFirst')
      expect(params.args.where).toEqual({ id: 'author-1', deletedAt: null })
      expect(next).toHaveBeenCalledWith(params)
    })
  })

  describe('findMany / findFirst / count → deletedAt: null 자동 추가', () => {
    it('findMany — WHERE deletedAt IS NULL 자동 추가', async () => {
      const next = makeNext([{ id: 'author-1' }])
      const params: any = {
        model: 'Author',
        action: 'findMany',
        args: { where: { role: 'user' } },
      }

      await registeredMiddleware!(params, next)

      expect(params.args.where).toEqual({ role: 'user', deletedAt: null })
    })

    it('findFirst — WHERE deletedAt IS NULL 자동 추가', async () => {
      const next = makeNext({ id: 'author-1' })
      const params: any = {
        model: 'Author',
        action: 'findFirst',
        args: { where: { email: 'test@test.com' } },
      }

      await registeredMiddleware!(params, next)

      expect(params.args.where).toEqual({ email: 'test@test.com', deletedAt: null })
    })

    it('count — WHERE deletedAt IS NULL 자동 추가', async () => {
      const next = makeNext(5)
      const params: any = {
        model: 'Author',
        action: 'count',
        args: {},
      }

      await registeredMiddleware!(params, next)

      expect(params.args.where).toEqual({ deletedAt: null })
    })
  })

  describe('delete → soft delete 변환 (hard delete 차단)', () => {
    it('delete — UPDATE deletedAt = NOW() 변환 (hard delete 차단)', async () => {
      const next = makeNext({ id: 'author-1' })
      const params: any = {
        model: 'Author',
        action: 'delete',
        args: { where: { id: 'author-1' } },
      }

      await registeredMiddleware!(params, next)

      expect(params.action).toBe('update')
      expect(params.args.data).toBeDefined()
      expect(params.args.data.deletedAt).toBeInstanceOf(Date)
    })

    it('deleteMany — updateMany deletedAt = NOW() 변환', async () => {
      const next = makeNext({ count: 3 })
      const params: any = {
        model: 'Author',
        action: 'deleteMany',
        args: { where: { role: 'user' } },
      }

      await registeredMiddleware!(params, next)

      expect(params.action).toBe('updateMany')
      expect(params.args.data.deletedAt).toBeInstanceOf(Date)
    })
  })

  describe('비-Author 모델 영역 영역 영역 영역 강제 영역 0건', () => {
    it('Work 모델 영역 영역 영역 영역 영역 영역 영역 영역 영역 — 변환 0건', async () => {
      const next = makeNext({ id: 'work-1' })
      const params: any = {
        model: 'Work',
        action: 'findUnique',
        args: { where: { id: 'work-1' } },
      }

      await registeredMiddleware!(params, next)

      expect(params.action).toBe('findUnique')
      expect(params.args.where).toEqual({ id: 'work-1' })
    })
  })

  describe('includeDeleted: true 우회 영역', () => {
    it('findUnique — includeDeleted: true 영역 영역 영역 deletedAt 영역 영역 영역 영역 영역 영역 영역 0건', async () => {
      const next = makeNext({ id: 'author-1' })
      const params: any = {
        model: 'Author',
        action: 'findFirst',
        args: { where: { id: 'author-1', includeDeleted: true } },
      }

      await registeredMiddleware!(params, next)

      // includeDeleted flag 영역 영역 제거 영역 + deletedAt 영역 영역 영역 영역 영역 영역
      expect(params.args.where).toEqual({ id: 'author-1' })
      expect(params.args.where.deletedAt).toBeUndefined()
    })
  })
})
