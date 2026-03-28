import { AdminGuard } from './admin.guard'
import { ForbiddenException } from '@nestjs/common'

describe('AdminGuard', () => {
  let guard: AdminGuard
  let mockAuthorRepo: { findById: jest.Mock }

  const mockContext = (userId?: string) => ({
    switchToHttp: () => ({
      getRequest: () => ({ user: userId ? { sub: userId } : undefined }),
    }),
  }) as any

  beforeEach(() => {
    mockAuthorRepo = { findById: jest.fn() }
    guard = new AdminGuard(mockAuthorRepo as any)
  })

  it('관리자 role이면 true를 반환한다', async () => {
    mockAuthorRepo.findById.mockResolvedValue({ id: 'a1', role: 'admin' })
    const result = await guard.canActivate(mockContext('a1'))
    expect(result).toBe(true)
  })

  it('user role이면 ForbiddenException을 던진다', async () => {
    mockAuthorRepo.findById.mockResolvedValue({ id: 'a1', role: 'user' })
    await expect(guard.canActivate(mockContext('a1'))).rejects.toThrow(ForbiddenException)
  })

  it('유저가 없으면 ForbiddenException을 던진다', async () => {
    await expect(guard.canActivate(mockContext())).rejects.toThrow(ForbiddenException)
  })

  it('DB에 작가가 없으면 ForbiddenException을 던진다', async () => {
    mockAuthorRepo.findById.mockResolvedValue(null)
    await expect(guard.canActivate(mockContext('no-one'))).rejects.toThrow(ForbiddenException)
  })
})
