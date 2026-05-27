import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { EmailVerificationUseCase } from './email-verification.usecase'
import { EmailVerificationTokenRepositoryPort } from '@domain/port/outbound/email-verification-token-repository.port'
import { EmailServicePort } from '@domain/port/outbound/email-service.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { hashToken } from '@domain/model/email-verification-token'

/**
 * EmailVerificationUseCase spec — 사용자 절대 규정 0-1 정합 검증.
 *
 * 핵심 검증:
 * - NullEmailAdapter (default) 시 토큰 발급/DB 박제 정상 + 외부 발송 0
 * - 토큰 검증 흐름 — 만료/redeem/유효 분기
 * - enumeration 차단 — 미등록 이메일 응답 동일
 */
describe('EmailVerificationUseCase', () => {
  let useCase: EmailVerificationUseCase
  let tokenRepo: jest.Mocked<EmailVerificationTokenRepositoryPort>
  let emailService: jest.Mocked<EmailServicePort>
  let authorRepo: jest.Mocked<AuthorRepositoryPort>

  beforeEach(async () => {
    tokenRepo = {
      create: jest.fn(),
      findByTokenHash: jest.fn(),
      markRedeemed: jest.fn(),
      deleteExpired: jest.fn(),
    }
    emailService = {
      sendVerificationEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
      sendPaymentNotification: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(false),
      getProviderName: jest.fn().mockReturnValue('null'),
    }
    authorRepo = {
      findById: jest.fn(),
      findBySlug: jest.fn(),
      findByEmail: jest.fn(),
      findBySlugOrEmail: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      softDelete: jest.fn(),
      restore: jest.fn(),
      findSoftDeleted: jest.fn(),
    } as unknown as jest.Mocked<AuthorRepositoryPort>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationUseCase,
        { provide: 'EmailVerificationTokenRepositoryPort', useValue: tokenRepo },
        { provide: 'EmailServicePort', useValue: emailService },
        { provide: 'AuthorRepositoryPort', useValue: authorRepo },
      ],
    }).compile()

    useCase = module.get(EmailVerificationUseCase)
  })

  describe('sendVerification', () => {
    it('NullAdapter (default) 시 DB 박제 정상 + 외부 발송 0 (logger.warn만)', async () => {
      authorRepo.findById.mockResolvedValue({
        id: 'a1',
        slug: 'test',
        name: 'Test',
        email: 'test@example.com',
        role: 'user',
      } as never)
      tokenRepo.create.mockResolvedValue({
        id: 't1',
        authorId: 'a1',
        email: 'test@example.com',
        tokenHash: 'hash',
        purpose: 'verify_email',
        expireAt: new Date(),
        redeemedAt: null,
        createdAt: new Date(),
      })
      emailService.sendVerificationEmail.mockResolvedValue({
        messageId: null,
        provider: 'null',
      })

      const result = await useCase.sendVerification('a1')

      expect(result).toEqual({ issued: true, provider: 'null' })
      expect(tokenRepo.create).toHaveBeenCalledTimes(1)
      expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1)
      // 외부 호출은 NullAdapter가 받음 — 호출 자체는 발생하지만 외부 API 0건
      const createArg = tokenRepo.create.mock.calls[0][0]
      expect(createArg.purpose).toBe('verify_email')
      expect(createArg.tokenHash).toMatch(/^[a-f0-9]{64}$/) // sha256
      // 평문 토큰은 sendXxx에 박제, DB에는 hash만
      const sendArg = emailService.sendVerificationEmail.mock.calls[0][0]
      expect(sendArg.token).toMatch(/^[A-Za-z0-9_-]{43}$/) // 평문
      expect(sendArg.token).not.toBe(createArg.tokenHash) // 평문 ≠ hash
    })

    it('미등록 authorId 시 NotFoundException', async () => {
      authorRepo.findById.mockResolvedValue(null)
      await expect(useCase.sendVerification('unknown')).rejects.toThrow(NotFoundException)
      expect(tokenRepo.create).not.toHaveBeenCalled()
      expect(emailService.sendVerificationEmail).not.toHaveBeenCalled()
    })
  })

  describe('sendPasswordReset (enumeration 차단)', () => {
    it('등록 이메일 → 토큰 발송', async () => {
      authorRepo.findByEmail.mockResolvedValue({
        id: 'a1',
        slug: 'test',
        name: 'Test',
        email: 'test@example.com',
        role: 'user',
      } as never)
      tokenRepo.create.mockResolvedValue({
        id: 't1',
        authorId: 'a1',
        email: 'test@example.com',
        tokenHash: 'hash',
        purpose: 'password_reset',
        expireAt: new Date(),
        redeemedAt: null,
        createdAt: new Date(),
      })
      emailService.sendPasswordResetEmail.mockResolvedValue({
        messageId: null,
        provider: 'null',
      })

      const result = await useCase.sendPasswordReset('test@example.com')

      expect(result).toEqual({ issued: true, provider: 'null' })
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    })

    it('미등록 이메일 → 응답 동일 (issued=true), DB 박제 0', async () => {
      authorRepo.findByEmail.mockResolvedValue(null)

      const result = await useCase.sendPasswordReset('unknown@example.com')

      // enumeration 차단 — 미등록 이메일도 issued=true 반환
      expect(result.issued).toBe(true)
      expect(tokenRepo.create).not.toHaveBeenCalled()
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled()
    })
  })

  describe('verifyToken', () => {
    it('유효 토큰 → redeem + return', async () => {
      const plainToken = 'plaintoken_abc123_xyz'
      const tokenHash = hashToken(plainToken)
      tokenRepo.findByTokenHash.mockResolvedValue({
        id: 't1',
        authorId: 'a1',
        email: 'test@example.com',
        tokenHash,
        purpose: 'verify_email',
        expireAt: new Date(Date.now() + 60_000), // 1분 후 만료
        redeemedAt: null,
        createdAt: new Date(),
      })

      const result = await useCase.verifyToken(plainToken)

      expect(result).toEqual({
        authorId: 'a1',
        email: 'test@example.com',
        purpose: 'verify_email',
      })
      expect(tokenRepo.markRedeemed).toHaveBeenCalledWith('t1', expect.any(Date))
    })

    it('빈 토큰 → BadRequestException', async () => {
      await expect(useCase.verifyToken('')).rejects.toThrow(BadRequestException)
    })

    it('DB 미존재 토큰 → BadRequestException "토큰이 유효하지 않습니다"', async () => {
      tokenRepo.findByTokenHash.mockResolvedValue(null)
      await expect(useCase.verifyToken('unknown-token')).rejects.toThrow('토큰이 유효하지 않습니다')
      expect(tokenRepo.markRedeemed).not.toHaveBeenCalled()
    })

    it('만료 토큰 → BadRequestException "토큰이 만료되었습니다"', async () => {
      const plainToken = 'expired-token'
      const tokenHash = hashToken(plainToken)
      tokenRepo.findByTokenHash.mockResolvedValue({
        id: 't2',
        authorId: 'a1',
        email: 'test@example.com',
        tokenHash,
        purpose: 'verify_email',
        expireAt: new Date(Date.now() - 60_000), // 1분 전 만료
        redeemedAt: null,
        createdAt: new Date(),
      })

      await expect(useCase.verifyToken(plainToken)).rejects.toThrow('토큰이 만료되었습니다')
      expect(tokenRepo.markRedeemed).not.toHaveBeenCalled()
    })

    it('이미 사용된 토큰 → BadRequestException "이미 사용된 토큰입니다" (재사용 차단)', async () => {
      const plainToken = 'redeemed-token'
      const tokenHash = hashToken(plainToken)
      tokenRepo.findByTokenHash.mockResolvedValue({
        id: 't3',
        authorId: 'a1',
        email: 'test@example.com',
        tokenHash,
        purpose: 'password_reset',
        expireAt: new Date(Date.now() + 60_000),
        redeemedAt: new Date(Date.now() - 30_000),
        createdAt: new Date(),
      })

      await expect(useCase.verifyToken(plainToken)).rejects.toThrow('이미 사용된 토큰입니다')
      expect(tokenRepo.markRedeemed).not.toHaveBeenCalled()
    })
  })
})
