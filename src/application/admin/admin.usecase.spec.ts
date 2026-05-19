import { AdminUseCase } from './admin.usecase'
import { NotFoundException, BadRequestException } from '@nestjs/common'

describe('AdminUseCase', () => {
  let useCase: AdminUseCase
  let mockAuthorRepo: any
  let mockWorkRepo: any
  let mockCreditRepo: any
  // 크레딧 개편 CC-1 (2026-05-19) — 구 mockCreditUseCase → mockGrantPoints + mockLedger
  let mockGrantPoints: any
  let mockLedger: any
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
    // 신 포인트 원장 적립 UseCase mock — grantManual 호출 검증용
    mockGrantPoints = {
      grantManual: jest.fn().mockResolvedValue(undefined),
    }
    // 신 CreditLedger 포트 mock — getBalance(잔액 박제용) + spend(관리자 차감)
    // getBalance 기본: 가용 10,000pt (deductCredits 잔액 검증 통과 기본값)
    mockLedger = {
      getBalance: jest.fn().mockResolvedValue({
        free: 5000, subscription: 0, gift: 0, charged: 5000,
        total: 10000, deficit: 0, available: 10000,
      }),
      spend: jest.fn().mockResolvedValue({
        spentBySource: { free: 5000, subscription: 0, gift: 0, charged: 0 },
        deficitIncurred: 0,
        balanceAfter: 5000,
      }),
    }
    mockAuditLog = {
      log: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    }

    const mockAdminRepo = {
      countComments: jest.fn().mockResolvedValue(5),
      countCompletedPayments: jest.fn().mockResolvedValue(3),
      listWorks: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getWorkDetail: jest.fn().mockResolvedValue({ id: 'w1', title: 'Test', author: { name: 'A', slug: 'a' }, episodes: [] }),
      getEpisodeDetail: jest.fn().mockResolvedValue({ id: 'ep1', status: 'public' }),
      changeEpisodeStatus: jest.fn().mockResolvedValue(undefined),
      listComments: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findComment: jest.fn().mockResolvedValue({ id: 'c1', episodeId: 'ep1', content: 'test' }),
      deleteComment: jest.fn().mockResolvedValue(undefined),
      listPayments: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getRevenueSummary: jest.fn().mockResolvedValue({ totalRevenue: 0, monthlyRevenue: 0, products: [] }),
      listAccessLogs: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      createSanction: jest.fn().mockResolvedValue({ id: 's1', type: 'warning' }),
      findSanction: jest.fn().mockResolvedValue({ id: 's1', authorId: 'author-1', type: 'warning' }),
      liftSanction: jest.fn().mockResolvedValue(undefined),
      listSanctions: jest.fn().mockResolvedValue([]),
      expireAndFindActiveSanction: jest.fn().mockResolvedValue(null),
      listReports: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findReport: jest.fn().mockResolvedValue({ id: 'r1', targetType: 'episode', targetId: 'ep1', status: 'pending' }),
      resolveReport: jest.fn().mockResolvedValue(undefined),
      hideEpisode: jest.fn().mockResolvedValue(undefined),
      deleteCommentById: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockResolvedValue({ maintenance_mode: 'false' }),
      updateSetting: jest.fn().mockResolvedValue(undefined),
      getTimeseries: jest.fn().mockResolvedValue([]),
      listAnnouncements: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      createAnnouncement: jest.fn().mockResolvedValue({ id: 'a1' }),
      deleteAnnouncement: jest.fn().mockResolvedValue(undefined),
      listFeatured: jest.fn().mockResolvedValue([]),
      addFeatured: jest.fn().mockResolvedValue({ id: 'f1' }),
      removeFeatured: jest.fn().mockResolvedValue(undefined),
      listSystemThemes: jest.fn().mockResolvedValue([]),
      findSystemTheme: jest.fn().mockResolvedValue({ id: 't1', source: 'system', name: 'Test' }),
      createSystemTheme: jest.fn().mockResolvedValue({ id: 't2', name: 'New' }),
      updateSystemTheme: jest.fn().mockResolvedValue({ id: 't1' }),
      deleteSystemTheme: jest.fn().mockResolvedValue(undefined),
    }

    useCase = new AdminUseCase(
      mockAuthorRepo, mockWorkRepo, mockCreditRepo, mockAdminRepo as any,
      mockGrantPoints, mockLedger, mockAuditLog,
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

  // 크레딧 개편 CC-1 (2026-05-19) — 관리자 지급·차감 신 포인트 원장 이행
  describe('크레딧 관리 (CC-1 — 신 포인트 원장)', () => {
    it('T5 — 포인트를 지급하고 감사 로그를 기록한다 (grantManual + 출처 명시)', async () => {
      const result = await useCase.grantCredits('admin-1', 'author-1', 3000, '프로모션', 'free')

      // author 존재 확인 + 잔액 사전/사후 조회 (신 원장 getBalance)
      expect(mockAuthorRepo.findById).toHaveBeenCalledWith('author-1')
      expect(mockLedger.getBalance).toHaveBeenCalledWith('author-1')

      // grantManual — 출처('free') + adminId 전달
      expect(mockGrantPoints.grantManual).toHaveBeenCalledWith('author-1', 'free', 3000, 'admin-1')

      // auditLog.log 6-arg — beforeState/afterState = 신 원장 total
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'admin-1',
        'credit_grant',
        'author-1',
        { amount: 3000, reason: '프로모션', source: 'free' },
        { points: 10000 },  // balanceBefore.total
        { points: 10000 },  // balanceAfter.total (mock — getBalance 동일값)
      )
      expect(result.balance.total).toBe(10000)
    })

    it('T5 — source 미지정 시 charged 폴백', async () => {
      await useCase.grantCredits('admin-1', 'author-1', 1000, '보상')
      expect(mockGrantPoints.grantManual).toHaveBeenCalledWith('author-1', 'charged', 1000, 'admin-1')
    })

    it('T5 — 유효하지 않은 source 시 charged 폴백', async () => {
      await useCase.grantCredits('admin-1', 'author-1', 1000, '보상', 'invalid-source')
      expect(mockGrantPoints.grantManual).toHaveBeenCalledWith('author-1', 'charged', 1000, 'admin-1')
    })

    it('T6 — 포인트를 차감하고 감사 로그를 기록한다 (ledger.spend)', async () => {
      const result = await useCase.deductCredits('admin-1', 'author-1', 5000, '정정')

      expect(mockAuthorRepo.findById).toHaveBeenCalledWith('author-1')
      // deficit 불가 모드 — 사전 잔액 검증 후 spend
      expect(mockLedger.spend).toHaveBeenCalledWith({
        authorId: 'author-1',
        amount: 5000,
        reason: 'admin_deduct:정정',
      })
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'admin-1',
        'credit_deduct',
        'author-1',
        { amount: 5000, reason: '정정' },
        { points: 10000 },
        { points: 10000 },
      )
      expect(result.balance.total).toBe(10000)
    })

    it('T6 — deficit 불가 모드: 가용 잔액 부족 시 BadRequestException + spend 미호출', async () => {
      // 가용 잔액 100pt 인데 5,000pt 차감 시도
      mockLedger.getBalance.mockResolvedValueOnce({
        free: 100, subscription: 0, gift: 0, charged: 0,
        total: 100, deficit: 0, available: 100,
      })
      await expect(
        useCase.deductCredits('admin-1', 'author-1', 5000, '정정'),
      ).rejects.toThrow(BadRequestException)
      // 외상 금지 — spend 자체가 호출되지 않음
      expect(mockLedger.spend).not.toHaveBeenCalled()
      expect(mockAuditLog.log).not.toHaveBeenCalled()
    })

    it('grantCredits — author 미존재 시 NotFoundException + grantManual/auditLog 호출 0회', async () => {
      mockAuthorRepo.findById.mockResolvedValueOnce(null)
      await expect(
        useCase.grantCredits('admin-1', 'missing-author', 3000, '프로모션'),
      ).rejects.toThrow(NotFoundException)
      expect(mockGrantPoints.grantManual).not.toHaveBeenCalled()
      expect(mockAuditLog.log).not.toHaveBeenCalled()
    })

    it('deductCredits — author 미존재 시 NotFoundException + spend/auditLog 호출 0회', async () => {
      mockAuthorRepo.findById.mockResolvedValueOnce(null)
      await expect(
        useCase.deductCredits('admin-1', 'missing-author', 5000, '정정'),
      ).rejects.toThrow(NotFoundException)
      expect(mockLedger.spend).not.toHaveBeenCalled()
      expect(mockAuditLog.log).not.toHaveBeenCalled()
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
