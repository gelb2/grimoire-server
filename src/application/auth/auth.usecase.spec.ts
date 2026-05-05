import { AuthUseCase } from './auth.usecase'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'

// google-auth-library Mock — googleLogin spec에서 OAuth2Client.verifyIdToken().getPayload() 결과 컨트롤
// 트랙 F (sprint #10_7) — OAuth email_verified 차단 spec 박제
const mockVerifyIdToken = jest.fn()
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}))

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

  // 트랙 F 강화안 A (sprint #10_7) — OAuth 자동 링크 보안 강화
  // RFC 6819 §5.1.1 / OWASP A07:2021 — email_verified=false OAuth 자동 링크 차단
  describe('googleLogin (트랙 F email_verified 차단)', () => {
    beforeEach(() => {
      mockVerifyIdToken.mockReset()
      mockAuthorRepo.findBySocialAccount = jest.fn()
      mockAuthorRepo.linkSocialAccount = jest.fn()
    })

    it('payload.email 없을 때 UnauthorizedException', async () => {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({ sub: 'google-sub-1', name: 'NoEmail' }),
      })

      await expect(authUseCase.googleLogin('google-token')).rejects.toThrow(
        UnauthorizedException,
      )
      await expect(authUseCase.googleLogin('google-token')).rejects.toThrow(
        'Google 인증 실패',
      )
    })

    it('email_verified=false 시 UnauthorizedException — 자동 링크 차단', async () => {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'attacker@example.com',
          email_verified: false,
          sub: 'google-sub-attacker',
          name: 'Attacker',
        }),
      })

      await expect(authUseCase.googleLogin('attacker-token')).rejects.toThrow(
        UnauthorizedException,
      )
      await expect(authUseCase.googleLogin('attacker-token')).rejects.toThrow(
        /Google 이메일이 아직 인증되지 않았습니다/,
      )
      // findByEmail 호출 차단 — email_verified=false면 자동 링크 시도 자체 안 함
      expect(mockAuthorRepo.findByEmail).not.toHaveBeenCalled()
      expect(mockAuthorRepo.linkSocialAccount).not.toHaveBeenCalled()
    })

    it('email_verified=true + 기존 소셜 연결 시 정상 로그인 (회귀 보존)', async () => {
      const existingAuthor = {
        id: 'a1',
        email: 'verified@example.com',
        slug: 'verified-user',
        name: '검증됨',
      }
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'verified@example.com',
          email_verified: true,
          sub: 'google-sub-verified',
          name: '검증됨',
        }),
      })
      mockAuthorRepo.findBySocialAccount.mockResolvedValue(existingAuthor)

      const result = await authUseCase.googleLogin('verified-token')

      expect(mockAuthorRepo.findBySocialAccount).toHaveBeenCalledWith(
        'google',
        'google-sub-verified',
      )
      expect(result.author).toMatchObject({
        id: 'a1',
        email: 'verified@example.com',
      })
      expect(result.accessToken).toBe('test-token')
    })

    it('email_verified 미박제 (undefined) 시 자동 링크 허용 — Google 기본 verified=true 정합', async () => {
      // Google OAuth payload는 기본적으로 email_verified=true
      // 일부 OAuth provider는 email_verified 필드 미제공 가능
      // 정책: undefined != false → 통과 (현 정책 보존, false만 명시 차단)
      const existingAuthor = {
        id: 'a2',
        email: 'no-verified-field@example.com',
        slug: 'noverified',
      }
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'no-verified-field@example.com',
          // email_verified 필드 미박제
          sub: 'google-sub-undef',
          name: 'NoField',
        }),
      })
      mockAuthorRepo.findBySocialAccount.mockResolvedValue(existingAuthor)

      const result = await authUseCase.googleLogin('undef-token')

      expect(result.author).toMatchObject({ id: 'a2' })
      expect(mockAuthorRepo.findBySocialAccount).toHaveBeenCalled()
    })
  })
})
