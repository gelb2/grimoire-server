import type { PrismaClient } from '@prisma/client'

/**
 * USER-SOFT-DELETE sprint (2026-05-15) — Prisma soft delete middleware.
 *
 * Author 영역 자동 변환:
 * 1. findUnique / findFirst / findMany / count → WHERE deletedAt IS NULL 자동 추가
 * 2. delete → update { deletedAt: NOW() }
 * 3. deleteMany → updateMany { deletedAt: NOW() }
 *
 * 명시 우회 영역 (운영자 영역):
 * - `args.where.includeDeleted: true` flag 영역 영역 — middleware 영역 우회 영역
 * - raw query 영역 영역 우회 영역 (Repository 영역 영역 영역 영역 영역)
 *
 * 정본: .claude/state/sprint-user-soft-delete-draft.md §10-1 middleware 자동 적용 영역
 * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
 */
export function applySoftDeleteMiddleware(prisma: PrismaClient): void {
  // @ts-expect-error — Prisma $use 영역 영역 영역 영역 영역 영역 영역 (PrismaClient extends 영역 영역)
  prisma.$use(async (params: any, next: any) => {
    if (params.model !== 'Author') return next(params)

    // (1) 조회 영역 (findUnique/findFirst/findMany/count) → deletedAt IS NULL 자동 추가
    if (
      ['findUnique', 'findFirst', 'findFirstOrThrow', 'findUniqueOrThrow', 'findMany', 'count'].includes(params.action)
    ) {
      // includeDeleted: true 영역 우회 영역 박제 영역
      const includeDeleted = params.args?.where?.includeDeleted === true
      if (includeDeleted) {
        // 우회 영역 — flag 영역 제거 영역 후 영역 영역 next 호출 영역
        delete params.args.where.includeDeleted
        return next(params)
      }

      params.args = params.args ?? {}
      params.args.where = params.args.where ?? {}

      // findUnique / findUniqueOrThrow 영역 영역 영역 영역 영역 (where 영역 영역 영역 영역) → findFirst 영역 영역 변환
      if (params.action === 'findUnique') {
        params.action = 'findFirst'
      } else if (params.action === 'findUniqueOrThrow') {
        params.action = 'findFirstOrThrow'
      }

      // deletedAt: null 영역 영역 영역 추가 영역
      params.args.where = {
        ...params.args.where,
        deletedAt: null,
      }
      return next(params)
    }

    // (2) delete → soft delete (update deletedAt = NOW)
    if (params.action === 'delete') {
      params.action = 'update'
      params.args.data = { deletedAt: new Date() }
      return next(params)
    }

    // (3) deleteMany → soft deleteMany (updateMany deletedAt = NOW)
    if (params.action === 'deleteMany') {
      params.action = 'updateMany'
      params.args = params.args ?? {}
      params.args.data = { deletedAt: new Date() }
      return next(params)
    }

    return next(params)
  })
}
