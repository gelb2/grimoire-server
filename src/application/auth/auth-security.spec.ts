import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { AdminGuard } from '@adapter/inbound/http/guard/admin.guard'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { SocialUseCase } from '@application/social/social.usecase'
import { WorkManagementUseCase } from '@application/work/work-management.usecase'

describe('보안 테스트', () => {
  // ── AdminGuard: 비관리자 차단 ──

  describe('AdminGuard', () => {
    let adminGuard: AdminGuard
    let mockAuthorRepo: any

    beforeEach(() => {
      mockAuthorRepo = {
        findById: jest.fn(),
      }
      adminGuard = new AdminGuard(mockAuthorRepo)
    })

    it('관리자가 아닌 사용자는 403을 반환한다', async () => {
      mockAuthorRepo.findById.mockResolvedValue({ id: 'user-1', role: 'user' })

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ user: { sub: 'user-1' } }),
        }),
      } as any

      await expect(adminGuard.canActivate(mockContext)).rejects.toThrow(ForbiddenException)
    })

    it('관리자 사용자는 통과한다', async () => {
      mockAuthorRepo.findById.mockResolvedValue({ id: 'admin-1', role: 'admin' })

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ user: { sub: 'admin-1' } }),
        }),
      } as any

      const result = await adminGuard.canActivate(mockContext)
      expect(result).toBe(true)
    })

    it('인증 정보가 없으면 403을 반환한다', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ user: undefined }),
        }),
      } as any

      await expect(adminGuard.canActivate(mockContext)).rejects.toThrow(ForbiddenException)
    })

    it('존재하지 않는 사용자는 403을 반환한다', async () => {
      mockAuthorRepo.findById.mockResolvedValue(null)

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ user: { sub: 'nonexistent' } }),
        }),
      } as any

      await expect(adminGuard.canActivate(mockContext)).rejects.toThrow(ForbiddenException)
    })
  })

  // ── JwtAuthGuard: 인증 없이 접근 차단 ──

  describe('JwtAuthGuard', () => {
    let jwtAuthGuard: JwtAuthGuard
    let mockJwtService: any

    beforeEach(() => {
      mockJwtService = {
        verify: jest.fn(),
      }
      jwtAuthGuard = new JwtAuthGuard(mockJwtService)
    })

    it('토큰 없으면 401을 반환한다', () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {}, cookies: {} }),
        }),
      } as any

      expect(() => jwtAuthGuard.canActivate(mockContext)).toThrow(UnauthorizedException)
    })

    it('Bearer 헤더 토큰으로 인증한다', () => {
      mockJwtService.verify.mockReturnValue({ sub: 'user-1', slug: 'test' })

      const request = { headers: { authorization: 'Bearer valid-token' }, cookies: {} }
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as any

      expect(jwtAuthGuard.canActivate(mockContext)).toBe(true)
      expect(request).toHaveProperty('user', { sub: 'user-1', slug: 'test' })
    })

    it('쿠키 토큰으로 인증한다 (헤더 없을 때)', () => {
      mockJwtService.verify.mockReturnValue({ sub: 'user-1', slug: 'test' })

      const request = { headers: {}, cookies: { grimoire_token: 'cookie-token' } }
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as any

      expect(jwtAuthGuard.canActivate(mockContext)).toBe(true)
      expect(mockJwtService.verify).toHaveBeenCalledWith('cookie-token')
    })

    it('헤더 토큰이 쿠키보다 우선한다', () => {
      mockJwtService.verify.mockReturnValue({ sub: 'user-1', slug: 'test' })

      const request = {
        headers: { authorization: 'Bearer header-token' },
        cookies: { grimoire_token: 'cookie-token' },
      }
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as any

      jwtAuthGuard.canActivate(mockContext)
      expect(mockJwtService.verify).toHaveBeenCalledWith('header-token')
    })

    it('유효하지 않은 토큰은 401을 반환한다', () => {
      mockJwtService.verify.mockImplementation(() => { throw new Error('invalid') })

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization: 'Bearer bad-token' }, cookies: {} }),
        }),
      } as any

      expect(() => jwtAuthGuard.canActivate(mockContext)).toThrow(UnauthorizedException)
    })
  })

  // ── Work/Episode 소유권 검증 ──

  describe('WorkManagementUseCase 소유권 검증', () => {
    let useCase: WorkManagementUseCase
    let mockWorkRepo: any

    beforeEach(() => {
      mockWorkRepo = {
        findById: jest.fn(),
        updateWork: jest.fn(),
        deleteWork: jest.fn(),
        findEpisodeById: jest.fn(),
        deleteEpisode: jest.fn(),
      }
      const mockBlobStorage = { isEnabled: false, uploadImage: jest.fn(), deleteImage: jest.fn() } as any
      useCase = new WorkManagementUseCase(mockWorkRepo, mockBlobStorage)
    })

    it('다른 사용자의 작품 수정 시 ForbiddenException을 던진다', async () => {
      mockWorkRepo.findById.mockResolvedValue({ id: 'work-1', authorId: 'author-1' })

      await expect(
        useCase.updateWork('other-author', 'work-1', { title: '해킹' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('다른 사용자의 작품 삭제 시 ForbiddenException을 던진다', async () => {
      mockWorkRepo.findById.mockResolvedValue({ id: 'work-1', authorId: 'author-1' })

      await expect(
        useCase.deleteWork('other-author', 'work-1'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('다른 사용자의 에피소드 삭제 시 ForbiddenException을 던진다', async () => {
      mockWorkRepo.findEpisodeById.mockResolvedValue({ id: 'ep-1', workId: 'work-1' })
      mockWorkRepo.findById.mockResolvedValue({ id: 'work-1', authorId: 'author-1' })

      await expect(
        useCase.deleteEpisode('other-author', 'ep-1'),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  // ── 댓글 XSS 새니타이제이션 ──

  describe('SocialUseCase 댓글 새니타이제이션', () => {
    let useCase: SocialUseCase
    let mockSocialRepo: any

    beforeEach(() => {
      mockSocialRepo = {
        createComment: jest.fn().mockResolvedValue({
          id: 'comment-1',
          authorId: 'user-1',
          episodeId: 'ep-1',
          content: '',
          createdAt: new Date(),
        }),
      }
      useCase = new SocialUseCase(mockSocialRepo)
    })

    it('HTML 태그가 이스케이프된다', async () => {
      await useCase.createComment('user-1', 'ep-1', '<script>alert("xss")</script>')

      expect(mockSocialRepo.createComment).toHaveBeenCalledWith(
        'user-1',
        'ep-1',
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
        undefined,
      )
    })

    it('일반 텍스트는 그대로 전달된다', async () => {
      await useCase.createComment('user-1', 'ep-1', '좋은 소설이네요!')

      expect(mockSocialRepo.createComment).toHaveBeenCalledWith(
        'user-1',
        'ep-1',
        '좋은 소설이네요!',
        undefined,
      )
    })

    it('앰퍼샌드와 따옴표가 이스케이프된다', async () => {
      await useCase.createComment('user-1', 'ep-1', 'Tom & Jerry\'s "adventure"')

      expect(mockSocialRepo.createComment).toHaveBeenCalledWith(
        'user-1',
        'ep-1',
        'Tom &amp; Jerry&#x27;s &quot;adventure&quot;',
        undefined,
      )
    })
  })
})
