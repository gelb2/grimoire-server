import { UserSoftDeleteUseCase } from './user-soft-delete.usecase'
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common'

describe('UserSoftDeleteUseCase (USER-SOFT-DELETE sprint 2026-05-15)', () => {
  let useCase: UserSoftDeleteUseCase
  let mockAuthorRepo: {
    findById: jest.Mock
    softDelete: jest.Mock
  }
  let mockAuthTokenRepo: { revokeAllByAuthorId: jest.Mock }
  let mockAnonymizer: { anonymize: jest.Mock }
  let mockAuditLog: { log: jest.Mock }

  const mockAuthor = {
    id: 'author-1',
    slug: 'test-author',
    name: '테스트 작가',
    email: 'test@test.com',
    passwordHash: 'hashed',
    role: 'user',
    bio: 'bio',
    credits: 5,
    plan: 'free',
    planExpireAt: null,
    defaultThemeId: null,
    createdAt: new Date('2026-01-01'),
    deletedAt: null,
  }

  const mockAdminAuthor = {
    ...mockAuthor,
    id: 'admin-1',
    slug: 'admin-user',
    role: 'admin',
  }

  beforeEach(() => {
    mockAuthorRepo = {
      findById: jest.fn().mockResolvedValue(mockAuthor),
      softDelete: jest.fn().mockResolvedValue(undefined),
    }
    mockAuthTokenRepo = {
      revokeAllByAuthorId: jest.fn().mockResolvedValue(undefined),
    }
    mockAnonymizer = {
      anonymize: jest.fn().mockResolvedValue(undefined),
    }
    mockAuditLog = {
      log: jest.fn().mockResolvedValue(undefined),
    }

    useCase = new UserSoftDeleteUseCase(
      mockAuthorRepo as any,
      mockAuthTokenRepo as any,
      mockAnonymizer as any,
      mockAuditLog as any,
    )
  })

  describe('본인 탈퇴 (self)', () => {
    it('본인 탈퇴 — soft delete + GDPR 익명화 + RefreshToken Cascade 동시 적용', async () => {
      await useCase.execute('author-1', 'self')

      // 1. soft delete 호출
      expect(mockAuthorRepo.softDelete).toHaveBeenCalledWith('author-1')

      // 2. GDPR 익명화 호출 (옵션 A basic 영역)
      expect(mockAnonymizer.anonymize).toHaveBeenCalledWith('author-1', 'basic')

      // 3. RefreshToken 즉시 무효
      expect(mockAuthTokenRepo.revokeAllByAuthorId).toHaveBeenCalledWith('author-1')
    })

    it('본인 탈퇴 — AdminAuditLog self_account_delete + gdpr_anonymize 박제 (PAY-P2-4 6-arg)', async () => {
      await useCase.execute('author-1', 'self')

      // self_account_delete action 박제
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'author-1',
        'self_account_delete',
        'author-1',
        expect.objectContaining({ deletedBy: 'self', anonymizeScope: 'basic' }),
        expect.objectContaining({ id: 'author-1', slug: 'test-author' }),
        expect.objectContaining({ deletedAt: expect.any(String) }),
      )

      // gdpr_anonymize action 별도 박제
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'author-1',
        'gdpr_anonymize',
        'author-1',
        { scope: 'basic' },
      )
    })

    it('Author를 찾을 수 없으면 NotFoundException', async () => {
      mockAuthorRepo.findById.mockResolvedValue(null)
      await expect(useCase.execute('nonexistent', 'self')).rejects.toThrow(NotFoundException)
    })
  })

  describe('운영자 강제 삭제 (admin)', () => {
    it('운영자 강제 삭제 — soft delete + GDPR 익명화 + AdminAuditLog admin_force_delete 박제 (사유)', async () => {
      await useCase.execute('author-1', 'admin', 'admin-1', '욕설 신고 다수')

      // soft delete + anonymize + revoke
      expect(mockAuthorRepo.softDelete).toHaveBeenCalledWith('author-1')
      expect(mockAnonymizer.anonymize).toHaveBeenCalledWith('author-1', 'basic')
      expect(mockAuthTokenRepo.revokeAllByAuthorId).toHaveBeenCalledWith('author-1')

      // admin_force_delete action 박제 (adminId가 actorId)
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'admin-1',
        'admin_force_delete',
        'author-1',
        expect.objectContaining({ deletedBy: 'admin', reason: '욕설 신고 다수', anonymizeScope: 'basic' }),
        expect.any(Object),
        expect.any(Object),
      )
    })

    it('운영자 강제 삭제 — adminId 누락 시 BadRequestException', async () => {
      await expect(
        useCase.execute('author-1', 'admin', undefined, '사유 영역'),
      ).rejects.toThrow(BadRequestException)
    })

    it('운영자 강제 삭제 — 사유 누락/빈 문자열 시 BadRequestException', async () => {
      await expect(
        useCase.execute('author-1', 'admin', 'admin-1'),
      ).rejects.toThrow(BadRequestException)
      await expect(
        useCase.execute('author-1', 'admin', 'admin-1', '   '),
      ).rejects.toThrow(BadRequestException)
    })

    it('운영자 강제 삭제 — 본인이 본인 강제 삭제 시 ForbiddenException (실수 차단)', async () => {
      mockAuthorRepo.findById.mockResolvedValue({ ...mockAuthor, id: 'admin-1' })
      await expect(
        useCase.execute('admin-1', 'admin', 'admin-1', '사유'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('운영자 강제 삭제 — admin 계정 강제 삭제 차단 BadRequestException', async () => {
      mockAuthorRepo.findById.mockResolvedValue(mockAdminAuthor)
      await expect(
        useCase.execute('admin-1', 'admin', 'super-admin-1', '관리자 영역'),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('GDPR 익명화 정합', () => {
    it('GDPR 익명화 — anonymizeScope 환경변수 영역 (기본 basic)', async () => {
      // process.env.GDPR_ANONYMIZE_SCOPE 영역 영역 영역 영역 basic 영역 호출 영역 영역 영역 박제
      await useCase.execute('author-1', 'self')
      expect(mockAnonymizer.anonymize).toHaveBeenCalledWith('author-1', 'basic')
    })

    it('RefreshToken Cascade 정합 — soft delete 시점에 즉시 무효 강제', async () => {
      await useCase.execute('author-1', 'self')
      // softDelete 호출 이후 revokeAllByAuthorId 호출 정합 확인
      const softDeleteCallOrder = mockAuthorRepo.softDelete.mock.invocationCallOrder[0]
      const revokeCallOrder = mockAuthTokenRepo.revokeAllByAuthorId.mock.invocationCallOrder[0]
      expect(softDeleteCallOrder).toBeLessThan(revokeCallOrder)
    })
  })
})
