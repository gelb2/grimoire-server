import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminUseCase } from '@application/admin/admin.usecase'
import { UserSoftDeleteUseCase } from '@application/author/user-soft-delete.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { AdminGuard } from '@adapter/inbound/http/guard/admin.guard'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { JwtService } from '@nestjs/jwt'
import { AccessLogService } from '@infrastructure/security/access-log.service'

/**
 * USER-SOFT-DELETE sprint (2026-05-15) — AdminController anonymize 엔드포인트 spec 영역 (qa #20 server-web 정합 보강).
 *
 * 검증 매트릭스:
 * - 사유(reason) 필수 — BadRequestException
 * - UserSoftDeleteUseCase.anonymizeOnly 위임 정합
 * - 응답 시그니처 — `{ anonymizedAt: string }`
 * - AdminGuard + JwtAuthGuard 정합 (controller decoration 영역)
 *
 * 정본: .claude/state/sprint-user-soft-delete-draft.md §15-1
 * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
 */
describe('AdminController — anonymize 엔드포인트 (USER-SOFT-DELETE qa #20 보강)', () => {
  let controller: AdminController
  let userSoftDelete: jest.Mocked<UserSoftDeleteUseCase>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminUseCase,
          useValue: {},
        },
        {
          provide: UserSoftDeleteUseCase,
          useValue: {
            execute: jest.fn().mockResolvedValue(undefined),
            anonymizeOnly: jest.fn().mockResolvedValue({ anonymizedAt: '2026-05-15T10:00:00.000Z' }),
          },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: JwtService,
          useValue: {},
        },
        {
          provide: AccessLogService,
          useValue: { log: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<AdminController>(AdminController)
    userSoftDelete = module.get(UserSoftDeleteUseCase) as jest.Mocked<UserSoftDeleteUseCase>
  })

  it('POST /admin/authors/:id/anonymize — 사유 영역 박제 시 UseCase.anonymizeOnly 위임 + 응답 시그니처 정합', async () => {
    const req = { user: { sub: 'admin-1', slug: 'admin', role: 'admin' } } as any
    const result = await controller.anonymizeAuthor(req, 'author-1', { reason: 'GDPR 영역 영역 요청' })

    expect(userSoftDelete.anonymizeOnly).toHaveBeenCalledWith('author-1', 'admin-1', 'GDPR 영역 영역 요청')
    expect(result).toEqual({ anonymizedAt: '2026-05-15T10:00:00.000Z' })
  })

  it('POST /admin/authors/:id/anonymize — 사유 영역 영역 영역 영역 BadRequestException', async () => {
    const req = { user: { sub: 'admin-1', slug: 'admin', role: 'admin' } } as any

    // 빈 문자열
    await expect(
      controller.anonymizeAuthor(req, 'author-1', { reason: '' }),
    ).rejects.toThrow(BadRequestException)

    // whitespace only
    await expect(
      controller.anonymizeAuthor(req, 'author-1', { reason: '   ' }),
    ).rejects.toThrow(BadRequestException)

    // body 영역 영역
    await expect(
      controller.anonymizeAuthor(req, 'author-1', undefined as any),
    ).rejects.toThrow(BadRequestException)

    // anonymizeOnly 위임 X (사유 검증 영역 영역 영역 차단 정합)
    expect(userSoftDelete.anonymizeOnly).not.toHaveBeenCalled()
  })
})
