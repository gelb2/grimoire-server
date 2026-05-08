import { PrismaPaymentRepository } from './prisma-payment.repository'

/**
 * PrismaPaymentRepository 단위 테스트 (Sprint PAY-P1-3 — findReusablePendingPayment 정합성 검증).
 *
 * 4 it 블록 (AC-2 정본):
 * (a) 정상 재사용 — 24h 이내 동일 (authorId, productId, status='pending') row 반환
 * (b) 24h 초과 — expireSince 이전 createdAt row 0건 반환 (null)
 * (c) 다른 productId — productId 불일치 row 제외 (null)
 * (d) 다른 authorId — authorId 불일치 row 제외 (null)
 *
 * 더미 assertion 0건 — toHaveBeenCalledWith로 WHERE 절 인자 정합 박제 (Constitution P15).
 */
describe('PrismaPaymentRepository.findReusablePendingPayment', () => {
  let repo: PrismaPaymentRepository
  let mockPrisma: any

  const NOW = new Date('2026-05-04T12:00:00Z')
  const EXPIRE_SINCE = new Date(NOW.getTime() - 24 * 60 * 60 * 1000) // now - 24h

  const mockPayment = {
    id: 'pay-reuse-1',
    authorId: 'author-1',
    productId: 'credit-5',
    amount: 2000,
    credits: 5,
    status: 'pending',
    externalTransactionId: 'TRADE-old',
    createdAt: new Date(NOW.getTime() - 5 * 60 * 1000), // 5분 전
    completedAt: null,
  }

  beforeEach(() => {
    mockPrisma = {
      payment: {
        findFirst: jest.fn(),
      },
    }
    repo = new PrismaPaymentRepository(mockPrisma)
  })

  // ============================================================================
  // (a) 정상 재사용
  // ============================================================================
  it('24h 이내 동일 (authorId, productId, status=pending) row 1건 반환', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(mockPayment)

    const result = await repo.findReusablePendingPayment('author-1', 'credit-5', EXPIRE_SINCE)

    // WHERE 정합 검증 — authorId AND productId AND status='pending' AND createdAt > expireSince
    expect(mockPrisma.payment.findFirst).toHaveBeenCalledTimes(1)
    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith({
      where: {
        authorId: 'author-1',
        productId: 'credit-5',
        status: 'pending',
        createdAt: { gt: EXPIRE_SINCE },
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(result).toEqual(mockPayment)
    expect(result?.id).toBe('pay-reuse-1')
    expect(result?.status).toBe('pending')
  })

  // ============================================================================
  // (b) 24h 초과
  // ============================================================================
  it('24h 초과 시 findFirst가 null 반환 → null', async () => {
    // Prisma findFirst는 createdAt > expireSince 필터로 24h 초과 row를 자동 제외
    mockPrisma.payment.findFirst.mockResolvedValue(null)

    const result = await repo.findReusablePendingPayment('author-1', 'credit-5', EXPIRE_SINCE)

    // 호출 인자에 createdAt: { gt: expireSince } 정합 박제
    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gt: EXPIRE_SINCE },
        }),
      }),
    )
    expect(result).toBeNull()
  })

  // ============================================================================
  // (c) 다른 productId
  // ============================================================================
  it('다른 productId 호출 시 findFirst가 null 반환 → null (productId 필터 정합)', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null)

    const result = await repo.findReusablePendingPayment('author-1', 'credit-20', EXPIRE_SINCE)

    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authorId: 'author-1',
          productId: 'credit-20',
          status: 'pending',
        }),
      }),
    )
    expect(result).toBeNull()
  })

  // ============================================================================
  // (d) 다른 authorId
  // ============================================================================
  it('다른 authorId 호출 시 findFirst가 null 반환 → null (authorId 필터 정합)', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null)

    const result = await repo.findReusablePendingPayment('author-2', 'credit-5', EXPIRE_SINCE)

    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authorId: 'author-2',
          productId: 'credit-5',
          status: 'pending',
        }),
      }),
    )
    expect(result).toBeNull()
  })

  // ============================================================================
  // (e) ORDER BY createdAt DESC + LIMIT 1 정합
  // ============================================================================
  it('orderBy createdAt desc 정합 박제 (가장 최근 pending 우선)', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(mockPayment)

    await repo.findReusablePendingPayment('author-1', 'credit-5', EXPIRE_SINCE)

    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      }),
    )
  })
})
