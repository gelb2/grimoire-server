/**
 * 크레딧 개편 CC-1 (2026-05-19) — 적립·차감 연동 통합 테스트.
 *
 * 정본: reports/CREDIT_CORE_DIAGNOSIS.md §8 CC-1 행 + .claude/state/sprint-cc1-pay-s1-plan-draft.md §2-6
 *
 * ── 본 spec 의 존재 이유 (CRITICAL-2 근본 해결) ──
 * 직전 audit 에서 CRITICAL-2(적립 5경로 GrantPointsUseCase 미연동)가
 * "unit PASS 인데 런타임 미연동"으로 가려졌다. 각 usecase 의 unit spec 은
 * GrantPointsUseCase 를 mock 으로 대체하므로, usecase 가 실제로 적립을
 * 호출하는지를 검증하지 못한다.
 *
 * 본 통합 spec 은 GrantPointsUseCase / ChargePointsUseCase 의 **실 인스턴스**를
 * auth / work / admin / theme usecase 에 주입하고, CreditLedgerPort 만
 * 인메모리 fake 로 둔다. 그 결과 "usecase → 실 GrantPointsUseCase → ledger.earn"
 * 호출 사슬 전체가 검증된다 — 적립 호출이 누락되면 ledger 가 비어 FAIL.
 *
 * ⚠️ RED 재현: 각 usecase 에서 grant/charge 호출 라인을 주석 처리하면 본 spec 이
 * FAIL 한다 (적립 미연동 = CRITICAL-2 재현). 연동 완료 상태에서는 GREEN.
 *
 * 실 DB / 외부 API 미사용 (CLAUDE.md §4-8) — CreditLedgerPort fake 는
 * 도메인 정책(planConsumption/settleDeficitOnCharge)을 재사용해 소진 우선순위·
 * deficit 를 정확히 재현한다.
 */
import { AuthUseCase } from '@application/auth/auth.usecase'
import { WorkManagementUseCase } from '@application/work/work-management.usecase'
import { AdminUseCase } from '@application/admin/admin.usecase'
import { GenerateThemeUseCase } from '@application/theme/generate-theme.usecase'
import { GrantPointsUseCase } from '@application/credit/grant-points.usecase'
import { ChargePointsUseCase } from '@application/credit/charge-points.usecase'
import {
  CreditLedgerPort,
  CreditLedgerEntry,
  CreditBalance,
  SpendResult,
  EarnInput,
  SpendInput,
} from '@domain/port/outbound/credit-ledger.port'
import {
  planConsumption,
  settleDeficitOnCharge,
} from '@domain/policy/credit-consumption-policy'
import { THEME_POINT_COST } from '@domain/model/chat-charge-tier'
import { BadRequestException } from '@nestjs/common'

// google-auth-library Mock — AuthUseCase.googleLogin 미사용이나 import 안전성 위해 stub
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: jest.fn() })),
}))

/**
 * 인메모리 CreditLedgerPort fake — CreditLedger 1 테이블을 배열로 재현.
 * earn/spend/getBalance/settleDeficit/findByAuthor 를 도메인 정책으로 정확히 구현.
 * 통합 검증의 핵심: 적립이 실제 호출되면 ledger 배열에 row 가 쌓인다.
 */
class FakeCreditLedger implements CreditLedgerPort {
  /** 박제된 ledger row (검증 대상) */
  readonly rows: CreditLedgerEntry[] = []
  /** 작가별 4 출처 잔액 캐시 */
  private balances = new Map<
    string,
    { free: number; subscription: number; gift: number; charged: number; deficit: number }
  >()

  /** 테스트 셋업용 — 초기 잔액 시드 */
  seed(
    authorId: string,
    init: Partial<{ free: number; subscription: number; gift: number; charged: number; deficit: number }>,
  ): void {
    this.balances.set(authorId, {
      free: init.free ?? 0,
      subscription: init.subscription ?? 0,
      gift: init.gift ?? 0,
      charged: init.charged ?? 0,
      deficit: init.deficit ?? 0,
    })
  }

  private acc(authorId: string) {
    let b = this.balances.get(authorId)
    if (!b) {
      b = { free: 0, subscription: 0, gift: 0, charged: 0, deficit: 0 }
      this.balances.set(authorId, b)
    }
    return b
  }

  async earn(input: EarnInput): Promise<CreditLedgerEntry> {
    if (input.amount <= 0) throw new Error(`적립액은 양수여야 합니다: ${input.amount}`)
    const b = this.acc(input.authorId)
    b[input.source] += input.amount
    const total = b.free + b.subscription + b.gift + b.charged
    const entry: CreditLedgerEntry = {
      id: `ledger-${this.rows.length + 1}`,
      authorId: input.authorId,
      source: input.source,
      type: 'earn',
      amount: input.amount,
      balanceAfter: total,
      expiresAt: input.expiresAt ?? null,
      reason: input.reason,
      relatedId: input.relatedId ?? null,
      createdAt: new Date(),
    }
    this.rows.push(entry)
    return entry
  }

  async spend(input: SpendInput): Promise<SpendResult> {
    const b = this.acc(input.authorId)
    const plan = planConsumption(
      { free: b.free, subscription: b.subscription, gift: b.gift, charged: b.charged },
      input.amount,
    )
    // 출처별 차감 ledger row
    for (const source of ['free', 'subscription', 'gift', 'charged'] as const) {
      const take = plan.spentBySource[source]
      if (take > 0) {
        b[source] -= take
        this.rows.push({
          id: `ledger-${this.rows.length + 1}`,
          authorId: input.authorId,
          source,
          type: 'spend',
          amount: -take,
          balanceAfter: b.free + b.subscription + b.gift + b.charged,
          expiresAt: null,
          reason: input.reason,
          relatedId: input.relatedId ?? null,
          createdAt: new Date(),
        })
      }
    }
    // 부족분 deficit_incur
    if (plan.deficitIncurred > 0) {
      b.deficit += plan.deficitIncurred
      this.rows.push({
        id: `ledger-${this.rows.length + 1}`,
        authorId: input.authorId,
        source: 'charged',
        type: 'deficit_incur',
        amount: -plan.deficitIncurred,
        balanceAfter: b.free + b.subscription + b.gift + b.charged,
        expiresAt: null,
        reason: input.reason,
        relatedId: input.relatedId ?? null,
        createdAt: new Date(),
      })
    }
    return {
      spentBySource: plan.spentBySource,
      deficitIncurred: plan.deficitIncurred,
      balanceAfter: b.free + b.subscription + b.gift + b.charged,
    }
  }

  async getBalance(authorId: string): Promise<CreditBalance> {
    const b = this.acc(authorId)
    const total = b.free + b.subscription + b.gift + b.charged
    return {
      free: b.free,
      subscription: b.subscription,
      gift: b.gift,
      charged: b.charged,
      total,
      deficit: b.deficit,
      available: total - b.deficit,
    }
  }

  async settleDeficit(authorId: string, fromAmount: number): Promise<number> {
    const b = this.acc(authorId)
    const { settledDeficit, remainingDeficit } = settleDeficitOnCharge(fromAmount, b.deficit)
    b.deficit = remainingDeficit
    if (settledDeficit > 0) {
      this.rows.push({
        id: `ledger-${this.rows.length + 1}`,
        authorId,
        source: 'charged',
        type: 'deficit_settle',
        amount: settledDeficit,
        balanceAfter: b.free + b.subscription + b.gift + b.charged,
        expiresAt: null,
        reason: 'deficit_settle',
        relatedId: null,
        createdAt: new Date(),
      })
    }
    return settledDeficit
  }

  async findByAuthor(authorId: string, limit: number): Promise<CreditLedgerEntry[]> {
    return this.rows
      .filter((r) => r.authorId === authorId)
      .slice(-limit)
      .reverse()
  }

  /** CC-3 (HIGH-3) — 신 ledger 기반 선물 랭킹 fake */
  async getGiftRanking(
    limit: number,
  ): Promise<{ authorId: string; totalGifted: number }[]> {
    const sums = new Map<string, number>()
    for (const r of this.rows) {
      if (r.source === 'gift' && r.type === 'earn') {
        sums.set(r.authorId, (sums.get(r.authorId) ?? 0) + r.amount)
      }
    }
    return Array.from(sums.entries())
      .map(([authorId, totalGifted]) => ({ authorId, totalGifted }))
      .sort((a, b) => b.totalGifted - a.totalGifted)
      .slice(0, limit)
  }

  /**
   * CC-2b — 응원 선물 양측 작가 1 트랜잭션 이동 (案 G1).
   * planConsumption 으로 sender 차감(deficit 금지) + receiver gift earn.
   */
  async transfer(
    senderId: string,
    receiverId: string,
    amount: number,
    relatedId?: string,
  ): Promise<{
    senderSpentBySource: Record<'free' | 'subscription' | 'gift' | 'charged', number>
    receiverGiftBalance: number
  }> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`선물 금액은 양의 정수여야 합니다: ${amount}`)
    }
    if (senderId === receiverId) {
      throw new Error('자기 자신에게 선물할 수 없습니다')
    }
    const sender = this.acc(senderId)
    const receiver = this.acc(receiverId)
    const plan = planConsumption(
      {
        free: sender.free,
        subscription: sender.subscription,
        gift: sender.gift,
        charged: sender.charged,
      },
      amount,
    )
    if (plan.deficitIncurred > 0) {
      throw new Error('포인트가 부족합니다')
    }
    const senderTotalBefore =
      sender.free + sender.subscription + sender.gift + sender.charged
    const senderBalanceAfter = senderTotalBefore - amount
    for (const source of ['free', 'subscription', 'gift', 'charged'] as const) {
      const take = plan.spentBySource[source]
      if (take > 0) {
        sender[source] -= take
        this.rows.push({
          id: `ledger-${this.rows.length + 1}`,
          authorId: senderId,
          source,
          type: 'spend',
          amount: -take,
          balanceAfter: senderBalanceAfter,
          expiresAt: null,
          reason: `gift_sent:${receiverId}`,
          relatedId: relatedId ?? null,
          createdAt: new Date(),
        })
      }
    }
    receiver.gift += amount
    const receiverTotalAfter =
      receiver.free + receiver.subscription + receiver.gift + receiver.charged
    this.rows.push({
      id: `ledger-${this.rows.length + 1}`,
      authorId: receiverId,
      source: 'gift',
      type: 'earn',
      amount,
      balanceAfter: receiverTotalAfter,
      expiresAt: null,
      reason: `gift_received:${senderId}`,
      relatedId: relatedId ?? null,
      createdAt: new Date(),
    })
    return {
      senderSpentBySource: plan.spentBySource,
      receiverGiftBalance: receiver.gift,
    }
  }

  /** 검증 헬퍼 — 특정 작가의 earn row 만 */
  earnRowsOf(authorId: string): CreditLedgerEntry[] {
    return this.rows.filter((r) => r.authorId === authorId && r.type === 'earn')
  }
}

describe('CC-1 적립·차감 연동 통합 테스트 (CreditLedger 실 연동 검증)', () => {
  let ledger: FakeCreditLedger
  let grantPoints: GrantPointsUseCase
  let chargePoints: ChargePointsUseCase

  // ChargePointsUseCase 가 받는 부수 포트 stub (테마 차감 검증용)
  let mockSettingRepo: any
  let mockAuthorRepoForCharge: any

  beforeEach(() => {
    ledger = new FakeCreditLedger()
    // 실 GrantPointsUseCase — CreditLedgerPort 만 fake
    grantPoints = new GrantPointsUseCase(ledger)
    // 실 ChargePointsUseCase — ledger fake + setting/author stub
    mockSettingRepo = { findByPrefix: jest.fn().mockResolvedValue([]) }
    mockAuthorRepoForCharge = { findById: jest.fn() }
    chargePoints = new ChargePointsUseCase(ledger, mockSettingRepo, mockAuthorRepoForCharge)
  })

  // ─────────────────────────────────────────────────────────
  // C8b — T1 가입 보너스: AuthUseCase 가 실제로 grantSignupBonus 를 호출하는가
  // ─────────────────────────────────────────────────────────
  describe('T1 — 가입 보너스 (AuthUseCase → CreditLedger)', () => {
    function buildAuthUseCase(): { useCase: AuthUseCase; authorRepo: any } {
      const authorRepo = {
        findByEmail: jest.fn().mockResolvedValue(null),
        findBySlug: jest.fn().mockResolvedValue(null),
        findById: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'new-author',
          slug: 'newcomer',
          name: '신규작가',
          email: 'newcomer@test.com',
          role: 'user',
          createdAt: new Date(),
        }),
      }
      const jwtService = { sign: jest.fn().mockReturnValue('jwt-token') }
      const authTokenRepo = { create: jest.fn().mockResolvedValue(undefined) }
      const signupHistoryRepo = {
        findByProviderId: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(undefined),
      }
      // 실 GrantPointsUseCase 주입 — mock 아님
      const useCase = new AuthUseCase(
        authorRepo as any,
        jwtService as any,
        grantPoints,
        authTokenRepo as any,
        signupHistoryRepo as any,
      )
      return { useCase, authorRepo }
    }

    it('email 가입 시 CreditLedger 에 source=free 3,000pt earn row 가 박힌다', async () => {
      const { useCase } = buildAuthUseCase()

      await useCase.register({
        email: 'newcomer@test.com',
        password: 'password123',
        name: '신규작가',
        slug: 'newcomer',
      })

      // 미연동(grantSignupBonus 미호출)이면 earnRows 가 비어 FAIL — CRITICAL-2 재현 지점
      const earnRows = ledger.earnRowsOf('new-author')
      expect(earnRows).toHaveLength(1)
      expect(earnRows[0]).toMatchObject({
        source: 'free',
        type: 'earn',
        amount: GrantPointsUseCase.SIGNUP_BONUS_POINTS,
        reason: 'signup_bonus',
      })
      // 잔액도 3,000pt 가용
      const balance = await ledger.getBalance('new-author')
      expect(balance.free).toBe(3000)
      expect(balance.available).toBe(3000)
    })
  })

  // ─────────────────────────────────────────────────────────
  // C8c — T2 첫 작품 보너스: WorkManagementUseCase → CreditLedger
  // ─────────────────────────────────────────────────────────
  describe('T2 — 첫 작품 보너스 (WorkManagementUseCase → CreditLedger)', () => {
    function buildWorkUseCase(episodesFiltered: any[]): WorkManagementUseCase {
      const workRepo = {
        findEpisodeById: jest.fn().mockResolvedValue({
          id: 'ep-1',
          workId: 'work-1',
          status: 'upload',
        }),
        findById: jest.fn().mockResolvedValue({ id: 'work-1', authorId: 'author-1' }),
        findEpisodesFiltered: jest.fn().mockResolvedValue(episodesFiltered),
        updateEpisodeStatus: jest.fn().mockResolvedValue({ id: 'ep-1', status: 'public' }),
      }
      const blobStorage = { isEnabled: false }
      const novelAnalysis = { indexEpisode: jest.fn() }
      // 실 GrantPointsUseCase 주입
      return new WorkManagementUseCase(
        workRepo as any,
        blobStorage as any,
        novelAnalysis as any,
        grantPoints,
      )
    }

    it('첫 public 전환 시 CreditLedger 에 source=free 2,000pt earn row 가 박힌다', async () => {
      // 같은 작품에 아직 public 에피소드 없음 → 첫 작품 보너스 대상
      const useCase = buildWorkUseCase([{ id: 'ep-1', status: 'upload' }])

      await useCase.updateEpisodeStatus('author-1', 'ep-1', 'public')

      const earnRows = ledger.earnRowsOf('author-1')
      expect(earnRows).toHaveLength(1)
      expect(earnRows[0]).toMatchObject({
        source: 'free',
        amount: GrantPointsUseCase.FIRST_WORK_BONUS_POINTS,
        reason: 'first_work_bonus',
      })
    })

    it('이미 public 에피소드가 있으면 earn row 가 박히지 않는다 (멱등)', async () => {
      // 이미 public 에피소드 존재 → 첫 작품 보너스 미적립
      const useCase = buildWorkUseCase([
        { id: 'ep-1', status: 'upload' },
        { id: 'ep-2', status: 'public' },
      ])

      await useCase.updateEpisodeStatus('author-1', 'ep-1', 'public')

      expect(ledger.earnRowsOf('author-1')).toHaveLength(0)
    })
  })

  // ─────────────────────────────────────────────────────────
  // C8d — T5/T6 관리자 지급·차감: AdminUseCase → CreditLedger
  // ─────────────────────────────────────────────────────────
  describe('T5/T6 — 관리자 지급·차감 (AdminUseCase → CreditLedger)', () => {
    function buildAdminUseCase(): AdminUseCase {
      const authorRepo = {
        findById: jest.fn().mockResolvedValue({
          id: 'author-1',
          slug: 'test',
          role: 'user',
          createdAt: new Date(),
        }),
      }
      const workRepo = {}
      const creditRepo = {}
      const adminRepo = {}
      const auditLog = { log: jest.fn().mockResolvedValue(undefined) }
      // 실 GrantPointsUseCase + 실 ledger fake 주입
      return new AdminUseCase(
        authorRepo as any,
        workRepo as any,
        creditRepo as any,
        adminRepo as any,
        grantPoints,
        ledger,
        auditLog as any,
      )
    }

    it('T5 — 관리자 지급 시 CreditLedger 에 출처별 earn row 가 박힌다', async () => {
      const useCase = buildAdminUseCase()

      await useCase.grantCredits('admin-1', 'author-1', 5000, '프로모션', 'free')

      const earnRows = ledger.earnRowsOf('author-1')
      expect(earnRows).toHaveLength(1)
      expect(earnRows[0]).toMatchObject({ source: 'free', amount: 5000 })
      expect(earnRows[0].reason).toContain('admin_grant')
    })

    it('T6 — 관리자 차감 시 CreditLedger 에 spend row 가 박힌다', async () => {
      // 잔액 시드 — charged 10,000pt
      ledger.seed('author-1', { charged: 10000 })
      const useCase = buildAdminUseCase()

      await useCase.deductCredits('admin-1', 'author-1', 3000, '정정')

      const spendRows = ledger.rows.filter(
        (r) => r.authorId === 'author-1' && r.type === 'spend',
      )
      expect(spendRows.length).toBeGreaterThanOrEqual(1)
      // 차감 총액 = 3,000pt
      const totalSpent = spendRows.reduce((s, r) => s + Math.abs(r.amount), 0)
      expect(totalSpent).toBe(3000)
      const balance = await ledger.getBalance('author-1')
      expect(balance.total).toBe(7000)
    })

    it('T6 — deficit 불가 모드: 잔액 부족 시 spend row 0건 + BadRequestException', async () => {
      // 가용 잔액 100pt 인데 5,000pt 차감 시도
      ledger.seed('author-1', { free: 100 })
      const useCase = buildAdminUseCase()

      await expect(
        useCase.deductCredits('admin-1', 'author-1', 5000, '정정'),
      ).rejects.toThrow(BadRequestException)

      // 외상 금지 — ledger 에 어떤 row 도 박히지 않음 (deficit_incur 포함)
      expect(ledger.rows.filter((r) => r.authorId === 'author-1')).toHaveLength(0)
    })
  })

  // ─────────────────────────────────────────────────────────
  // C8e — T-신규 테마 차감: GenerateThemeUseCase → CreditLedger
  // ─────────────────────────────────────────────────────────
  describe('T-신규 — 테마 차감 (GenerateThemeUseCase → CreditLedger)', () => {
    const themeData = {
      bgPrimary: '#0a0a0a',
      tagline: '생성 테마',
      decorations: { headerSubtitle: 'TEST' },
    }

    function buildThemeUseCase(todayThemeCount: number): GenerateThemeUseCase {
      const claudeApi = { generateTheme: jest.fn().mockResolvedValue(themeData) }
      const themeRepo = {
        countByAuthorIdSince: jest.fn().mockResolvedValue(todayThemeCount),
        countByAuthorId: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'theme-1' }),
      }
      const authorRepo = {
        findById: jest.fn().mockResolvedValue({
          id: 'author-1',
          plan: 'free',
          planExpireAt: null,
        }),
      }
      // 실 ChargePointsUseCase 주입
      return new GenerateThemeUseCase(
        claudeApi as any,
        themeRepo as any,
        authorRepo as any,
        chargePoints,
      )
    }

    it('일일 무료 초과 시 CreditLedger 에 590pt spend row 가 박힌다', async () => {
      // 잔액 시드 — charged 5,000pt (테마 차감 가능)
      ledger.seed('author-1', { charged: 5000 })
      // todayThemeCount=100 → free 플랜 일일 한도 초과 → 차감 대상
      const useCase = buildThemeUseCase(100)

      await useCase.execute('author-1', '어둡고 묵직한 테마')

      const spendRows = ledger.rows.filter(
        (r) => r.authorId === 'author-1' && r.type === 'spend',
      )
      expect(spendRows.length).toBeGreaterThanOrEqual(1)
      const totalSpent = spendRows.reduce((s, r) => s + Math.abs(r.amount), 0)
      expect(totalSpent).toBe(THEME_POINT_COST)
      // 잔액 = 5,000 - 590
      const balance = await ledger.getBalance('author-1')
      expect(balance.total).toBe(5000 - THEME_POINT_COST)
    })

    it('일일 무료 범위 내면 ledger 에 어떤 row 도 박히지 않는다', async () => {
      ledger.seed('author-1', { charged: 5000 })
      // todayThemeCount=0 → 무료 범위 → 미차감
      const useCase = buildThemeUseCase(0)

      await useCase.execute('author-1', '무료 범위 테마')

      expect(ledger.rows.filter((r) => r.authorId === 'author-1')).toHaveLength(0)
    })

    it('테마 생성 실패 시 차감분이 환불되어 ledger 순잔액이 보존된다', async () => {
      ledger.seed('author-1', { charged: 5000 })
      const claudeApi = { generateTheme: jest.fn().mockRejectedValue(new Error('API 실패')) }
      const themeRepo = {
        countByAuthorIdSince: jest.fn().mockResolvedValue(100),
        countByAuthorId: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
      }
      const authorRepo = {
        findById: jest.fn().mockResolvedValue({ id: 'author-1', plan: 'free', planExpireAt: null }),
      }
      const useCase = new GenerateThemeUseCase(
        claudeApi as any,
        themeRepo as any,
        authorRepo as any,
        chargePoints,
      )

      await expect(useCase.execute('author-1', '실패 테마')).rejects.toThrow('API 실패')

      // 차감(590 spend) → 환불(590 earn) → 순잔액 5,000 보존
      const balance = await ledger.getBalance('author-1')
      expect(balance.total).toBe(5000)
      // ledger 에는 spend + earn(환불) 양쪽 row 가 모두 박혀 회계 추적 가능
      expect(ledger.rows.some((r) => r.type === 'spend')).toBe(true)
      expect(
        ledger.rows.some((r) => r.type === 'earn' && r.reason === 'theme_generate_refund'),
      ).toBe(true)
    })
  })
})
