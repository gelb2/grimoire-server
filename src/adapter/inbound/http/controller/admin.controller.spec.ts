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

/**
 * PAY-S3 Phase A (2026-05-23) — Circuit Breaker admin 엔드포인트 3 spec.
 *
 * 검증 매트릭스 (plan-draft C2h — 7 케이스):
 *   ① reason 빈값 400 (POST /trip)
 *   ② reason 공백만 400 (POST /reset)
 *   ③ key 화이트리스트 외 400 (POST /trip)
 *   ④ GET /state 정상 응답 — 내부 ID 노출 0건 + circuitKey 노출 허용
 *   ⑤ GET /state 단일 key (화이트리스트 외 입력 시 400)
 *   ⑥ POST /trip 정상 — beforeState/afterState 응답 시그니처 + UseCase 위임 정합
 *   ⑦ POST /reset 정상 — UseCase 위임 + 응답 시그니처
 *
 * Guard 검증(JwtAuthGuard/AdminGuard)은 controller decoration 영역(decorator 박제 = 정합 보장).
 * Throttle 검증은 controller decoration 영역 — spec 단위 검증 외(@Throttle 박제 확인은 빌드 + 런타임).
 */
import { CircuitBreakerState } from '@domain/model/circuit-breaker-state'

describe('AdminController — Circuit Breaker admin (PAY-S3 Phase A)', () => {
  let controller: AdminController
  let adminUseCase: jest.Mocked<AdminUseCase>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminUseCase,
          useValue: {
            getCircuitBreakerState: jest.fn().mockResolvedValue({
              state: CircuitBreakerState.CLOSED,
              failureCount: 0,
              halfOpenTrialCount: 0,
              halfOpenSuccessCount: 0,
            }),
            tripCircuitBreaker: jest.fn().mockResolvedValue({
              beforeState: {
                state: CircuitBreakerState.CLOSED,
                failureCount: 0,
                halfOpenTrialCount: 0,
                halfOpenSuccessCount: 0,
              },
              afterState: {
                state: CircuitBreakerState.OPEN,
                failureCount: 0,
                halfOpenTrialCount: 0,
                halfOpenSuccessCount: 0,
              },
            }),
            resetCircuitBreaker: jest.fn().mockResolvedValue({
              beforeState: {
                state: CircuitBreakerState.OPEN,
                failureCount: 5,
                halfOpenTrialCount: 0,
                halfOpenSuccessCount: 0,
              },
              afterState: {
                state: CircuitBreakerState.CLOSED,
                failureCount: 0,
                halfOpenTrialCount: 0,
                halfOpenSuccessCount: 0,
              },
            }),
          },
        },
        { provide: UserSoftDeleteUseCase, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: AccessLogService, useValue: { log: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<AdminController>(AdminController)
    adminUseCase = module.get(AdminUseCase) as jest.Mocked<AdminUseCase>
  })

  // ① reason 빈값 400 (POST /trip)
  it('POST /admin/circuit-breaker/trip — reason 빈값 시 BadRequestException + UseCase 미위임', async () => {
    const req = { user: { sub: 'admin-1', slug: 'admin', role: 'admin' } } as any
    await expect(
      controller.tripCircuitBreaker(req, { key: 'polar:checkouts:create', reason: '' } as any),
    ).rejects.toThrow(BadRequestException)

    expect(adminUseCase.tripCircuitBreaker).not.toHaveBeenCalled()
  })

  // ② reason 공백만 400 (POST /reset)
  it('POST /admin/circuit-breaker/reset — reason 공백만 시 BadRequestException', async () => {
    const req = { user: { sub: 'admin-1', slug: 'admin', role: 'admin' } } as any
    await expect(
      controller.resetCircuitBreaker(req, { key: 'polar:checkouts:list', reason: '   ' } as any),
    ).rejects.toThrow(BadRequestException)

    expect(adminUseCase.resetCircuitBreaker).not.toHaveBeenCalled()
  })

  // ③ key 화이트리스트 외 400 (POST /trip)
  it('POST /admin/circuit-breaker/trip — key 화이트리스트 외 입력 시 BadRequestException', async () => {
    const req = { user: { sub: 'admin-1', slug: 'admin', role: 'admin' } } as any
    await expect(
      controller.tripCircuitBreaker(req, {
        key: 'polar:checkouts:invalid' as any,
        reason: '사고 대응',
      }),
    ).rejects.toThrow(BadRequestException)

    expect(adminUseCase.tripCircuitBreaker).not.toHaveBeenCalled()
  })

  // ④ GET /state 정상 응답 + 내부 ID 노출 0건 검증
  it('GET /admin/circuit-breaker/state — 화이트리스트 2 호출점 응답 + 내부 ID 노출 0건', async () => {
    const result = await controller.getCircuitBreakerState()

    // 2 호출점 응답
    expect(result.states).toHaveLength(2)
    expect(result.states[0].key).toBe('polar:checkouts:create')
    expect(result.states[1].key).toBe('polar:checkouts:list')

    // policy 4값 포함 (운영자 정책 가시화)
    expect(result.states[0].policy).toEqual(
      expect.objectContaining({
        failureThreshold: expect.any(Number),
        cooldownMs: expect.any(Number),
        halfOpenTrial: expect.any(Number),
        resetWindowMs: expect.any(Number),
      }),
    )

    // 내부 ID 노출 0건 — DTO 에 authorId/email/passwordHash 등 필드 부재
    const flat = JSON.stringify(result)
    expect(flat).not.toMatch(/authorId/i)
    expect(flat).not.toMatch(/passwordHash/i)
    expect(flat).not.toMatch(/email/i)
  })

  // ⑤ GET /state 단일 key — 화이트리스트 외 400
  it('GET /admin/circuit-breaker/state — key 화이트리스트 외 query 시 BadRequestException', async () => {
    await expect(
      controller.getCircuitBreakerState('polar:webhooks:replay'),
    ).rejects.toThrow(BadRequestException)
  })

  // ⑥ POST /trip 정상 — UseCase 위임 + 응답 시그니처
  it('POST /admin/circuit-breaker/trip — 정상 시 UseCase 위임 + before/after state 응답', async () => {
    const req = { user: { sub: 'admin-1', slug: 'admin', role: 'admin' } } as any
    const result = await controller.tripCircuitBreaker(req, {
      key: 'polar:checkouts:create',
      reason: '사고 대응 — 결제 차단',
    })

    expect(adminUseCase.tripCircuitBreaker).toHaveBeenCalledWith(
      'admin-1',
      'polar:checkouts:create',
      '사고 대응 — 결제 차단',
    )
    expect(result).toEqual({
      success: true,
      beforeState: CircuitBreakerState.CLOSED,
      afterState: CircuitBreakerState.OPEN,
    })
  })

  // ⑦ POST /reset 정상 — UseCase 위임 + 응답 시그니처
  it('POST /admin/circuit-breaker/reset — 정상 시 UseCase 위임 + 복구 응답', async () => {
    const req = { user: { sub: 'admin-1', slug: 'admin', role: 'admin' } } as any
    const result = await controller.resetCircuitBreaker(req, {
      key: 'polar:checkouts:list',
      reason: '수동 복구',
    })

    expect(adminUseCase.resetCircuitBreaker).toHaveBeenCalledWith(
      'admin-1',
      'polar:checkouts:list',
      '수동 복구',
    )
    expect(result).toEqual({
      success: true,
      beforeState: CircuitBreakerState.OPEN,
      afterState: CircuitBreakerState.CLOSED,
    })
  })
})
