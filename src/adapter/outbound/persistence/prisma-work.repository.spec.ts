import { PrismaWorkRepository } from './prisma-work.repository'

/**
 * F-8 (2026-07-11) — soft-delete 작가 콘텐츠 노출 봉합 spec.
 *
 * soft-delete 는 Prisma `author.$allOperations` extension → top-level author op 만 필터하고
 * work 직접 조회/nested include 는 미적용(Prisma 한계). discovery/검색/shared 쿼리에
 * `author: { is: { deletedAt: null } }` 관계 필터가 명시됐는지 검증한다.
 * (discovery.usecase.spec 은 repo mock 이라 이 필터 갭을 못 잡음 → repo 레벨 검증 필요.)
 */
describe('PrismaWorkRepository — F-8 soft-delete 작가 제외', () => {
  let repo: PrismaWorkRepository
  let mockPrisma: any

  const AUTHOR_ALIVE = { author: { is: { deletedAt: null } } }

  beforeEach(() => {
    mockPrisma = {
      work: { findMany: jest.fn().mockResolvedValue([]) },
      episode: { findFirst: jest.fn().mockResolvedValue(null) },
      subscription: { groupBy: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    }
    repo = new PrismaWorkRepository(mockPrisma as any)
  })

  it('findPopular 는 soft-delete 작가 작품을 제외한다 (where author.deletedAt=null)', async () => {
    await repo.findPopular(10)
    expect(mockPrisma.work.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: AUTHOR_ALIVE }),
    )
  })

  it('findRecent 는 soft-delete 작가 작품을 제외한다', async () => {
    await repo.findRecent(10)
    expect(mockPrisma.work.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: AUTHOR_ALIVE }),
    )
  })

  it('findPopularPaginated / findRecentPaginated 도 동일 필터', async () => {
    await repo.findPopularPaginated(1, 10)
    await repo.findRecentPaginated(1, 10)
    for (const call of mockPrisma.work.findMany.mock.calls) {
      expect(call[0].where).toEqual(AUTHOR_ALIVE)
    }
  })

  it('searchByTitle 은 title 조건 + soft-delete 작가 제외를 함께 건다', async () => {
    await repo.searchByTitle('도리안', 20)
    expect(mockPrisma.work.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          title: { contains: '도리안', mode: 'insensitive' },
          author: { is: { deletedAt: null } },
        },
      }),
    )
  })

  it('findBySharedToken 은 soft-delete 작가의 shared 에피소드 접근을 차단한다', async () => {
    await repo.findBySharedToken('tok_abc')
    expect(mockPrisma.episode.findFirst).toHaveBeenCalledWith({
      where: { sharedToken: 'tok_abc', work: { author: { is: { deletedAt: null } } } },
    })
  })

  it('shared 토큰 조회가 null(제외됨)이면 null 반환', async () => {
    mockPrisma.episode.findFirst.mockResolvedValue(null)
    expect(await repo.findBySharedToken('tok_deleted_author')).toBeNull()
  })
})
