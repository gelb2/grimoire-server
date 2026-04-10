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

    useCase = new AdminUseCase(
      mockAuthorRepo, mockWorkRepo, mockCreditRepo,
      mockCreditUseCase, mockAuditLog,
    )
  })

  describe('getStats', () => {
    it('플랫폼 통계를 올바르게 반환한다', async () => {
      const result = await useCase.getStats()

      expect(result.totalAuthors).toBe(10)
      expect(result.totalWorks).toBe(25)
      expect(result.totalEpisodes).toBe(120)
      expect(result.totalCreditsConsumed).toBe(50)
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
})
