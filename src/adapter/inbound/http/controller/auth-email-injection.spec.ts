import { Test } from '@nestjs/testing'
import { AuthController } from './auth.controller'
import { AuthUseCase } from '@application/auth/auth.usecase'
import { EmailVerificationUseCase } from '@application/auth/email-verification.usecase'
import { AccessLogService } from '@infrastructure/security/access-log.service'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { AuthenticatedRequest } from '../dto/authenticated-request'
import { JwtService } from '@nestjs/jwt'

describe('인증 메일 실제 Nest 주입', () => {
  it('등록된 EmailVerificationUseCase를 선택 의존성에 주입한다', async () => {
    const sendVerification = jest.fn().mockResolvedValue({ issued: true, provider: 'null' })
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthUseCase, useValue: {} },
        { provide: AccessLogService, useValue: { log: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: EmailVerificationUseCase, useValue: { sendVerification } },
      ],
    }).compile()
    const controller = module.get(AuthController)
    await expect(controller.emailVerifyRequest({ user: { sub: 'local-fixture' }, headers: {} } as AuthenticatedRequest))
      .resolves.toEqual({ issued: true, provider: 'null' })
    expect(sendVerification).toHaveBeenCalledWith('local-fixture')
    await module.close()
  })
})
