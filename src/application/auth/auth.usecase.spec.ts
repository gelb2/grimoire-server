import { AuthUseCase } from './auth.usecase'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'

describe('AuthUseCase', () => {
  let authUseCase: AuthUseCase
  let mockAuthorRepo: any
  let mockJwtService: any
  let mockCreditUseCase: any
  let mockPrisma: any

  beforeEach(() => {
    mockAuthorRepo = {
      findByEmail: jest.fn(),
      findBySlug: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    }
    mockJwtService = {
      sign: jest.fn().mockReturnValue('test-token'),
    }
    mockCreditUseCase = {
      grant: jest.fn().mockResolvedValue({ credits: 3, log: {} }),
    }
    const mockAuthTokenRepo = {
      create: jest.fn().mockResolvedValue(undefined),
      findByHash: jest.fn(),
      revoke: jest.fn(),
      revokeByHash: jest.fn(),
      revokeAllByAuthorId: jest.fn(),
    }
    const mockSignupHistoryRepo = {
      findByProviderId: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    }
    authUseCase = new AuthUseCase(mockAuthorRepo, mockJwtService, mockCreditUseCase, mockAuthTokenRepo, mockSignupHistoryRepo)
  })

  describe('register', () => {
    it('새 작가를 등록한다', async () => {
      mockAuthorRepo.findByEmail.mockResolvedValue(null)
      mockAuthorRepo.findBySlug.mockResolvedValue(null)
      mockAuthorRepo.create.mockResolvedValue({
        id: 'test-id',
        slug: 'test',
        name: '테스트',
        email: 'test@test.com',
        credits: 3,
        createdAt: new Date(),
      })

      const result = await authUseCase.register({
        email: 'test@test.com',
        password: 'password123',
        name: '테스트',
        slug: 'test',
      })

      expect(result.author.email).toBe('test@test.com')
      expect(result.accessToken).toBe('test-token')
      expect(mockAuthorRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'test@test.com', name: '테스트', slug: 'test' }),
      )
    })

    it('중복 이메일이면 예외를 던진다', async () => {
      mockAuthorRepo.findByEmail.mockResolvedValue({ id: 'existing' })

      await expect(
        authUseCase.register({ email: 'dup@test.com', password: 'pass', name: '이름', slug: 'slug' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('중복 슬러그면 예외를 던진다', async () => {
      mockAuthorRepo.findByEmail.mockResolvedValue(null)
      mockAuthorRepo.findBySlug.mockResolvedValue({ id: 'existing' })

      await expect(
        authUseCase.register({ email: 'new@test.com', password: 'pass', name: '이름', slug: 'dup' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('login', () => {
    it('올바른 자격증명으로 로그인한다', async () => {
      const hash = await bcrypt.hash('password123', 10)
      mockAuthorRepo.findByEmail.mockResolvedValue({
        id: 'test-id',
        slug: 'test',
        name: '테스트',
        email: 'test@test.com',
        passwordHash: hash,
        credits: 3,
        createdAt: new Date(),
      })

      const result = await authUseCase.login({ email: 'test@test.com', password: 'password123' })
      expect(result.accessToken).toBe('test-token')
    })

    it('잘못된 비밀번호면 예외를 던진다', async () => {
      const hash = await bcrypt.hash('correct', 10)
      mockAuthorRepo.findByEmail.mockResolvedValue({
        id: 'test-id',
        passwordHash: hash,
      })

      await expect(
        authUseCase.login({ email: 'test@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('존재하지 않는 이메일이면 예외를 던진다', async () => {
      mockAuthorRepo.findByEmail.mockResolvedValue(null)

      await expect(
        authUseCase.login({ email: 'noone@test.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException)
    })

    describe('PAY-P0-3 / EMAIL-P0-3 — slug 로그인 마이그레이션', () => {
      it('slug + 비번 정상 — findBySlug 분기 → accessToken 반환', async () => {
        const hash = await bcrypt.hash('password123', 10)
        mockAuthorRepo.findBySlug.mockResolvedValue({
          id: 'slug-id',
          slug: 'deerdevil',
          name: '사슴악마',
          email: 'deerdevil@example.com',
          passwordHash: hash,
          credits: 5,
          createdAt: new Date(),
        })

        const result = await authUseCase.login({ slug: 'deerdevil', password: 'password123' })

        expect(mockAuthorRepo.findBySlug).toHaveBeenCalledWith('deerdevil')
        expect(mockAuthorRepo.findByEmail).not.toHaveBeenCalled()
        expect(mockAuthorRepo.findBySlug).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({
          accessToken: 'test-token',
          author: expect.objectContaining({ slug: 'deerdevil', email: 'deerdevil@example.com' }),
        })
      })

      it('slug 미존재 → UnauthorizedException (식별자 노출 회피 — 동일 메시지)', async () => {
        mockAuthorRepo.findBySlug.mockResolvedValue(null)

        await expect(authUseCase.login({ slug: 'no-such-slug', password: 'pass' })).rejects.toThrow(
          UnauthorizedException,
        )
        expect(mockAuthorRepo.findBySlug).toHaveBeenCalledWith('no-such-slug')
      })

      it('email + slug 동시 박제 → BadRequestException (XOR 강제)', async () => {
        await expect(
          authUseCase.login({ email: 'a@b.com', slug: 'a', password: 'pass' }),
        ).rejects.toThrow(BadRequestException)
        expect(mockAuthorRepo.findByEmail).not.toHaveBeenCalled()
        expect(mockAuthorRepo.findBySlug).not.toHaveBeenCalled()
      })

      it('email + slug 둘 다 미박제 → BadRequestException (XOR 강제)', async () => {
        await expect(authUseCase.login({ password: 'pass' } as { password: string })).rejects.toThrow(
          BadRequestException,
        )
        expect(mockAuthorRepo.findByEmail).not.toHaveBeenCalled()
        expect(mockAuthorRepo.findBySlug).not.toHaveBeenCalled()
      })

      it('email 후향호환 회귀 — 기존 email 로그인은 findByEmail 분기 (AC-4)', async () => {
        const hash = await bcrypt.hash('legacy-pass', 10)
        mockAuthorRepo.findByEmail.mockResolvedValue({
          id: 'legacy-id',
          slug: 'legacy',
          email: 'legacy@example.com',
          passwordHash: hash,
        })

        const result = await authUseCase.login({ email: 'legacy@example.com', password: 'legacy-pass' })

        expect(mockAuthorRepo.findByEmail).toHaveBeenCalledWith('legacy@example.com')
        expect(mockAuthorRepo.findByEmail).toHaveBeenCalledTimes(1)
        expect(mockAuthorRepo.findBySlug).not.toHaveBeenCalled()
        expect(result).toMatchObject({
          accessToken: 'test-token',
          author: expect.objectContaining({ email: 'legacy@example.com' }),
        })
      })

      it('slug 박제 + 비번 불일치 → UnauthorizedException', async () => {
        const hash = await bcrypt.hash('correct', 10)
        mockAuthorRepo.findBySlug.mockResolvedValue({
          id: 'slug-id',
          passwordHash: hash,
        })

        await expect(
          authUseCase.login({ slug: 'deerdevil', password: 'wrong' }),
        ).rejects.toThrow(UnauthorizedException)
      })
    })
  })
})
