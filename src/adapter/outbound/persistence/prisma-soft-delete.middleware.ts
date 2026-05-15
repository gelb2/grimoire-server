import { PrismaClient } from '@prisma/client'

/**
 * USER-SOFT-DELETE sprint (2026-05-15) — Author soft delete 자동 변환.
 *
 * Prisma 6.x 정합 (2026-05-15 revision 159 ActivationFailed hotfix):
 * - Prisma 5.x `$use` middleware 는 Prisma 6.x 에서 **완전 제거**됨 (`prisma.$use` === undefined).
 * - 정본 방식 = Prisma Client Extensions (`$extends`) 의 `query` 컴포넌트.
 * - `applySoftDeleteExtension(prisma)` 는 확장된 **새 PrismaClient 인스턴스**를 반환한다
 *   (`$extends` 는 원본을 in-place 변경하지 않음 — 호출 측이 반환값을 사용해야 함).
 *
 * Author 모델 자동 변환:
 * 1. findUnique / findUniqueOrThrow / findFirst / findFirstOrThrow / findMany / count
 *    → WHERE deletedAt IS NULL 자동 추가
 * 2. delete  → update { deletedAt: NOW() } 위임 (hard delete 차단)
 * 3. deleteMany → updateMany { deletedAt: NOW() } 위임
 *
 * 명시 우회 영역 (운영자 영역):
 * - `args.where.includeDeleted: true` flag → deletedAt 필터 미적용
 * - raw query (`$queryRaw` / `$executeRaw`) → extension 미적용 (Repository restore/hardDelete 정합)
 *
 * 정본: .claude/state/sprint-user-soft-delete-draft.md §10-1 자동 적용 영역
 * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
 */

/** Author 조회 액션 — deletedAt IS NULL 자동 필터 대상 */
export const AUTHOR_FIND_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
])

/**
 * Author 조회 args 에 deletedAt: null 필터를 주입한다.
 * `where.includeDeleted === true` 면 flag 만 제거하고 필터를 적용하지 않는다 (운영자 우회).
 */
export function withSoftDeleteFilter(
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(args ?? {}) }
  const where: Record<string, unknown> = { ...((next.where as Record<string, unknown>) ?? {}) }

  if (where.includeDeleted === true) {
    // 운영자 우회 — flag 제거 후 deletedAt 필터 미적용
    delete where.includeDeleted
    next.where = where
    return next
  }

  next.where = { ...where, deletedAt: null }
  return next
}

/**
 * Author soft delete 변환 결정.
 *
 * 주어진 operation 을 어떻게 처리할지 결정한 순수 함수 (단위 테스트 진입점).
 * - `kind: 'passthrough'` — 원본 operation 을 args 그대로 실행
 * - `kind: 'filtered'`    — 원본 operation 을 deletedAt 필터가 주입된 args 로 실행
 * - `kind: 'redirect'`    — 다른 모델 메서드(`redirectTo`)를 `args` 로 실행 (delete→update 등)
 */
export type SoftDeleteDecision =
  | { kind: 'passthrough' }
  | { kind: 'filtered'; args: Record<string, unknown> }
  | { kind: 'redirect'; redirectTo: 'update' | 'updateMany'; args: Record<string, unknown> }

/**
 * Author operation 의 soft delete 변환 결정을 계산한다.
 *
 * @param operation Prisma operation 명 (findMany / delete / ...)
 * @param args 원본 호출 args
 * @param now soft delete 시각 (테스트 결정성을 위해 주입 가능, 기본 = new Date())
 */
export function decideAuthorSoftDelete(
  operation: string,
  args: Record<string, unknown> | undefined,
  now: Date = new Date(),
): SoftDeleteDecision {
  // (1) 조회 — deletedAt IS NULL 자동 추가
  if (AUTHOR_FIND_OPERATIONS.has(operation)) {
    return { kind: 'filtered', args: withSoftDeleteFilter(args) }
  }

  // (2) delete → soft delete (update deletedAt = NOW)
  if (operation === 'delete') {
    const where = (args ?? {}).where as Record<string, unknown> | undefined
    return {
      kind: 'redirect',
      redirectTo: 'update',
      args: { where, data: { deletedAt: now } },
    }
  }

  // (3) deleteMany → soft deleteMany (updateMany deletedAt = NOW)
  if (operation === 'deleteMany') {
    const where = ((args ?? {}).where as Record<string, unknown> | undefined) ?? {}
    return {
      kind: 'redirect',
      redirectTo: 'updateMany',
      args: { where, data: { deletedAt: now } },
    }
  }

  // 그 외 (create / update / updateMany / upsert ...) — 변환 0건
  return { kind: 'passthrough' }
}

/**
 * Author soft delete `$allOperations` 콜백.
 *
 * Prisma 의 query extension 콜백 — Author 모델의 모든 operation 을 가로채
 * {@link decideAuthorSoftDelete} 결정에 따라 변형/위임한다. `query` 인자의 타입이
 * Prisma 내부 `JsArgs` 라 외부에서 직접 참조할 수 없어 `any` 로 받는다 (런타임 안전).
 *
 * @param prisma `$extends` 의 수신자 — delete→update 위임 시 모델 delegate 재호출에 사용
 */
function authorSoftDeleteCallback<T extends PrismaClient>(prisma: T) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async ({ operation, args, query }: any): Promise<unknown> => {
    const decision = decideAuthorSoftDelete(operation, args as Record<string, unknown>)

    if (decision.kind === 'filtered') {
      return query(decision.args)
    }

    if (decision.kind === 'redirect') {
      // delete → update / deleteMany → updateMany 위임 (확장 client 메서드 재호출)
      const delegate = prisma.author as unknown as Record<string, (a: unknown) => unknown>
      return delegate[decision.redirectTo](decision.args)
    }

    // passthrough
    return query(args)
  }
}

/**
 * 소프트 삭제 Client Extension 을 적용한 새 PrismaClient 를 반환한다.
 *
 * @param prisma 원본 PrismaClient (PrismaService 등)
 * @returns Author soft delete 가 적용된 확장 PrismaClient
 */
export function applySoftDeleteExtension<T extends PrismaClient>(prisma: T) {
  return prisma.$extends({
    name: 'author-soft-delete',
    query: {
      author: {
        $allOperations: authorSoftDeleteCallback(prisma),
      },
    },
  })
}

/**
 * 확장 PrismaClient 의 타입 별칭 — PrismaService 가 모델 delegate 를 위임할 때 참조.
 */
export type SoftDeleteExtendedClient = ReturnType<typeof applySoftDeleteExtension>
