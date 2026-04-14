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
    mockPrisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      signupHistory: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    }
    authUseCase = new AuthUseCase(mockAuthorRepo, mockJwtService, mockCreditUseCase, mockPrisma)
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
  })
})
