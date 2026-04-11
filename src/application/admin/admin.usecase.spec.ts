import { AdminUseCase } from './admin.usecase'
import { NotFoundException, BadRequestException } from '@nestjs/common'

describe('AdminUseCase', () => {
  let useCase: AdminUseCase
  let mockAuthorRepo: any
  let mockWorkRepo: any
  let mockCreditRepo: any
  let mockCreditUseCase: any
  let mockAuditLog: any

  beforeEach(() => {
    mockAuthorRepo = {
      count: jest.fn().mockResolvedValue(10),
      findById: jest.fn().mockResolvedValue({
        id: 'author-1', slug: 'test', name: 'Test', email: 'test@test.com',
        role: 'user', credits: 10, plan: 'free', planExpireAt: null, createdAt: new Date(),
      }),
      findByEmail: jest.fn().mockResolvedValue(null),
      findBySlug: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'new-1', slug: 'newuser', name: 'New', email: 'new@test.com', role: 'user', credits: 3, plan: 'free', planExpireAt: null, createdAt: new Date() }),
      updateProfile: jest.fn().mockResolvedValue({ id: 'author-1', name: 'Updated' }),
      updateRole: jest.fn().mockResolvedValue({ id: 'author-1', role: 'admin' }),
      updatePlan: jest.fn().mockResolvedValue({ id: 'author-1', plan: 'pro' }),
      deleteById: jest.fn().mockResolvedValue(undefined),
    }
    mockWorkRepo = {
      countAll: jest.fn().mockResolvedValue(25),
      countAllEpisodes: jest.fn().mockResolvedValue(120),
    }
    mockCreditRepo = {
      sumNegativeAmounts: jest.fn().mockResolvedValue(-50),
      findLogsByAuthorId: jest.fn().mockResolvedValue([]),
    }
    mockCreditUseCase = {
      grant: jest.fn().mockResolvedValue({ credits: 13, log: { id: 'log-1', authorId: 'author-1', amount: 10, reason: 'admin_grant', createdAt: new Date() } }),
      deduct: jest.fn().mockResolvedValue({ credits: 5, log: { id: 'log-2', authorId: 'author-1', amount: 5, reason: 'admin_deduct', createdAt: new Date() } }),
    }
    mockAuditLog = {
      log: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    }

    const mockPrisma = {
      comment: { count: jest.fn().mockResolvedValue(5), findMany: jest.fn().mockResolvedValue([]), delete: jest.fn(), findUnique: jest.fn().mockResolvedValue({ id: 'c1', episodeId: 'ep1', content: 'test' }) },
      payment: { count: jest.fn().mockResolvedValue(3), findMany: jest.fn().mockResolvedValue([]) },
      work: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn().mockResolvedValue({ id: 'w1', title: 'Test', author: { name: 'A', slug: 'a' }, episodes: [] }) },
      episode: { findUnique: jest.fn().mockResolvedValue({ id: 'ep1', status: 'public' }), update: jest.fn().mockResolvedValue({}) },
      accessLog: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      userSanction: { create: jest.fn().mockResolvedValue({ id: 's1', type: 'warning' }), findUnique: jest.fn().mockResolvedValue({ id: 's1', authorId: 'author-1', type: 'warning' }), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      report: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn().mockResolvedValue({ id: 'r1', targetType: 'episode', targetId: 'ep1', status: 'pending' }), update: jest.fn() },
      systemSetting: { findMany: jest.fn().mockResolvedValue([{ key: 'maintenance_mode', value: 'false' }]), upsert: jest.fn() },
    }

    useCase = new AdminUseCase(
      mockAuthorRepo, mockWorkRepo, mockCreditRepo,
      mockCreditUseCase, mockAuditLog, mockPrisma as any,
    )
  })

  describe('getStats', () => {
    it('플랫폼 통계를 올바르게 반환한다', async () => {
      const result = await useCase.getStats()

      expect(result.totalAuthors).toBe(10)
      expect(result.totalWorks).toBe(25)
      expect(result.totalEpisodes).toBe(120)
      expect(result.totalCreditsConsumed).toBe(50)
      expect(result.totalComments).toBe(5)
      expect(result.totalPaymentsCompleted).toBe(3)
    })

    it('크레딧 소비가 없으면 0을 반환한다', async () => {
      mockCreditRepo.sumNegativeAmounts.mockResolvedValue(0)
      const result = await useCase.getStats()
      expect(result.totalCreditsConsumed).toBe(0)
    })
  })

  describe('사용자 관리', () => {
    it('작가 목록을 조회한다', async () => {
      await useCase.listAuthors({ page: 1, limit: 20 })
      expect(mockAuthorRepo.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 })
    })

    it('작가 계정을 생성하고 감사 로그를 기록한다', async () => {
      const author = await useCase.createAuthor('admin-1', {
        email: 'new@test.com', name: 'New', slug: 'newuser', password: 'pw123',
      })
      expect(mockAuthorRepo.create).toHaveBeenCalled()
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'author_create', expect.any(String), expect.any(Object))
    })

    it('중복 이메일이면 예외를 던진다', async () => {
      mockAuthorRepo.findByEmail.mockResolvedValue({ id: 'existing' })
      await expect(useCase.createAuthor('admin-1', {
        email: 'dup@test.com', name: 'Dup', slug: 'dup', password: 'pw',
      })).rejects.toThrow(BadRequestException)
    })

    it('작가를 삭제하고 감사 로그를 기록한다', async () => {
      await useCase.deleteAuthor('admin-1', 'author-1')
      expect(mockAuthorRepo.deleteById).toHaveBeenCalledWith('author-1')
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'author_delete', 'author-1', expect.any(Object))
    })

    it('관리자 계정은 삭제할 수 없다', async () => {
      mockAuthorRepo.findById.mockResolvedValue({ id: 'admin-1', role: 'admin' })
      await expect(useCase.deleteAuthor('admin-1', 'admin-1')).rejects.toThrow(BadRequestException)
    })

    it('역할을 변경하고 감사 로그를 기록한다', async () => {
      await useCase.changeRole('admin-1', 'author-1', 'admin')
      expect(mockAuthorRepo.updateRole).toHaveBeenCalledWith('author-1', 'admin')
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'role_change', 'author-1', expect.any(Object))
    })
  })

  describe('크레딧 관리', () => {
    it('크레딧을 부여하고 감사 로그를 기록한다', async () => {
      const result = await useCase.grantCredits('admin-1', 'author-1', 10, '프로모션')
      expect(mockCreditUseCase.grant).toHaveBeenCalledWith('author-1', 10, 'admin_grant:프로모션')
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'credit_grant', 'author-1', { amount: 10, reason: '프로모션' })
      expect(result.credits).toBe(13)
    })

    it('크레딧을 차감하고 감사 로그를 기록한다', async () => {
      const result = await useCase.deductCredits('admin-1', 'author-1', 5, '정정')
      expect(mockCreditUseCase.deduct).toHaveBeenCalledWith('author-1', 5, 'admin_deduct:정정')
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'credit_deduct', 'author-1', { amount: 5, reason: '정정' })
    })
  })

  describe('플랜 관리', () => {
    it('플랜을 변경하고 감사 로그를 기록한다', async () => {
      await useCase.changePlan('admin-1', 'author-1', 'pro', 30)
      expect(mockAuthorRepo.updatePlan).toHaveBeenCalled()
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'plan_change', 'author-1', expect.any(Object))
    })
  })

  describe('감사 로그', () => {
    it('감사 로그를 조회한다', async () => {
      await useCase.getAuditLogs({ page: 1 })
      expect(mockAuditLog.findAll).toHaveBeenCalledWith({ page: 1 })
    })
  })

  describe('콘텐츠 관리', () => {
    it('작품 목록을 조회한다', async () => {
      const result = await useCase.listWorks({ page: 1, limit: 20 })
      expect(result).toHaveProperty('total')
    })

    it('에피소드 상태를 변경하고 감사 로그를 기록한다', async () => {
      await useCase.changeEpisodeStatus('admin-1', 'ep1', 'nonPublic' as any)
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'episode_status_change', 'ep1', expect.any(Object))
    })
  })

  describe('댓글 관리', () => {
    it('댓글을 삭제하고 감사 로그를 기록한다', async () => {
      await useCase.deleteComment('admin-1', 'c1')
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'comment_delete_admin', 'c1', expect.any(Object))
    })
  })

  describe('결제 내역', () => {
    it('결제 목록을 조회한다', async () => {
      const result = await useCase.listPayments({ page: 1 })
      expect(result).toHaveProperty('total')
    })
  })

  describe('접근 로그', () => {
    it('접근 로그를 조회한다', async () => {
      const result = await useCase.listAccessLogs({ page: 1 })
      expect(result).toHaveProperty('total')
    })
  })

  describe('제재 관리', () => {
    it('사용자를 제재하고 감사 로그를 기록한다', async () => {
      const result = await useCase.sanctionUser('admin-1', 'author-1', 'warning', '욕설')
      expect(result).toHaveProperty('id')
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'user_sanction', 'author-1', expect.any(Object))
    })

    it('관리자는 제재할 수 없다', async () => {
      mockAuthorRepo.findById.mockResolvedValue({ id: 'admin-1', role: 'admin' })
      await expect(useCase.sanctionUser('admin-1', 'admin-1', 'warning', 'test')).rejects.toThrow(BadRequestException)
    })

    it('제재를 해제하고 감사 로그를 기록한다', async () => {
      const result = await useCase.liftSanction('admin-1', 's1')
      expect(result.lifted).toBe(true)
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'user_sanction_lift', 'author-1', expect.any(Object))
    })
  })

  describe('신고 관리', () => {
    it('신고 목록을 조회한다', async () => {
      const result = await useCase.listReports({ page: 1, status: 'pending' })
      expect(result).toHaveProperty('total')
    })

    it('신고를 승인하고 감사 로그를 기록한다', async () => {
      await useCase.resolveReport('admin-1', 'r1', 'approved')
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'report_resolve', 'r1', expect.any(Object))
    })
  })

  describe('시스템 설정', () => {
    it('설정을 조회한다', async () => {
      const result = await useCase.getSettings()
      expect(result).toHaveProperty('maintenance_mode')
    })

    it('설정을 변경하고 감사 로그를 기록한다', async () => {
      await useCase.updateSetting('admin-1', 'maintenance_mode', 'true')
      expect(mockAuditLog.log).toHaveBeenCalledWith('admin-1', 'setting_change', 'maintenance_mode', { value: 'true' })
    })
  })
})
