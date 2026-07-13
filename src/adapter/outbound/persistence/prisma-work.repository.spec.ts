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

/**
 * F-20 (기획 §13) — 에피소드 순서 원자 재부여 spec.
 *
 * usecase spec(repo mock)은 소유권/집합 검증만 잡고 실제 재부여의 원자성(동시성 안전)을 못 잡는다.
 * 여기서 reorderEpisodes 가 전체 update 를 **단일 $transaction** 으로 묶는지 + 각 update 가
 * `{id, workId}` 스코프 + `orderNum=index+1` 인지 repo 레벨에서 검증한다.
 */
describe('PrismaWorkRepository — reorderEpisodes (F-20 원자 재부여)', () => {
  let repo: PrismaWorkRepository
  let mockPrisma: any

  beforeEach(() => {
    mockPrisma = {
      episode: { updateMany: jest.fn().mockImplementation((arg) => arg) },
      $transaction: jest.fn().mockResolvedValue([]),
    }
    repo = new PrismaWorkRepository(mockPrisma as any)
  })

  it('전체 순서를 단일 $transaction 으로 원자 재부여한다 (동시성 안전)', async () => {
    await repo.reorderEpisodes('work-1', ['ep-c', 'ep-a', 'ep-b'])
    // 단일 $transaction 호출 — 부분 갱신 불가(원자성/동시성)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    // 배열 형태 트랜잭션 — 에피소드 수만큼의 op
    const ops = mockPrisma.$transaction.mock.calls[0][0]
    expect(Array.isArray(ops)).toBe(true)
    expect(ops).toHaveLength(3)
  })

  it('각 update 는 {id, workId} 스코프 + orderNum=index+1 로 재부여한다 (타 작품 오염 방어)', async () => {
    await repo.reorderEpisodes('work-1', ['ep-c', 'ep-a', 'ep-b'])
    expect(mockPrisma.episode.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'ep-c', workId: 'work-1' },
      data: { orderNum: 1 },
    })
    expect(mockPrisma.episode.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'ep-a', workId: 'work-1' },
      data: { orderNum: 2 },
    })
    expect(mockPrisma.episode.updateMany).toHaveBeenNthCalledWith(3, {
      where: { id: 'ep-b', workId: 'work-1' },
      data: { orderNum: 3 },
    })
  })
})
