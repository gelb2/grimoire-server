import {
  decideAuthorSoftDelete,
  withSoftDeleteFilter,
  AUTHOR_FIND_OPERATIONS,
} from './prisma-soft-delete.middleware'

/**
 * USER-SOFT-DELETE sprint (2026-05-15) — Author soft delete 변환 단위 테스트.
 *
 * Prisma 6.x 정합 (revision 159 ActivationFailed hotfix):
 * - 기존 `$use` middleware 기반 spec 을 `$extends` 정본의 순수 결정 함수
 *   `decideAuthorSoftDelete` 검증으로 재작성.
 * - `decideAuthorSoftDelete` 는 실 DB 없이 변환 규칙(filtered / redirect / passthrough)
 *   을 결정하는 순수 함수이므로, extension 의 핵심 동작을 결정성 있게 검증한다.
 */
describe('PrismaSoftDeleteExtension — decideAuthorSoftDelete (USER-SOFT-DELETE 2026-05-15)', () => {
  // 결정성을 위한 고정 시각
  const FIXED_NOW = new Date('2026-05-15T10:00:00.000Z')

  describe('조회 액션 → deletedAt: null 자동 추가 (filtered)', () => {
    it('findUnique — WHERE deletedAt IS NULL 자동 추가', () => {
      const d = decideAuthorSoftDelete('findUnique', { where: { id: 'author-1' } }, FIXED_NOW)

      expect(d.kind).toBe('filtered')
      if (d.kind !== 'filtered') throw new Error('unreachable')
      expect(d.args.where).toEqual({ id: 'author-1', deletedAt: null })
    })

    it('findUniqueOrThrow — WHERE deletedAt IS NULL 자동 추가', () => {
      const d = decideAuthorSoftDelete('findUniqueOrThrow', { where: { slug: 'a' } }, FIXED_NOW)

      expect(d.kind).toBe('filtered')
      if (d.kind !== 'filtered') throw new Error('unreachable')
      expect(d.args.where).toEqual({ slug: 'a', deletedAt: null })
    })

    it('findMany — WHERE deletedAt IS NULL 자동 추가', () => {
      const d = decideAuthorSoftDelete('findMany', { where: { role: 'user' } }, FIXED_NOW)

      expect(d.kind).toBe('filtered')
      if (d.kind !== 'filtered') throw new Error('unreachable')
      expect(d.args.where).toEqual({ role: 'user', deletedAt: null })
    })

    it('findFirst — WHERE deletedAt IS NULL 자동 추가', () => {
      const d = decideAuthorSoftDelete('findFirst', { where: { email: 'test@test.com' } }, FIXED_NOW)

      expect(d.kind).toBe('filtered')
      if (d.kind !== 'filtered') throw new Error('unreachable')
      expect(d.args.where).toEqual({ email: 'test@test.com', deletedAt: null })
    })

    it('count — WHERE deletedAt IS NULL 자동 추가 (args 없음)', () => {
      const d = decideAuthorSoftDelete('count', {}, FIXED_NOW)

      expect(d.kind).toBe('filtered')
      if (d.kind !== 'filtered') throw new Error('unreachable')
      expect(d.args.where).toEqual({ deletedAt: null })
    })

    it('AUTHOR_FIND_OPERATIONS 6종 모두 filtered 로 결정된다', () => {
      for (const op of AUTHOR_FIND_OPERATIONS) {
        const d = decideAuthorSoftDelete(op, { where: {} }, FIXED_NOW)
        expect(d.kind).toBe('filtered')
      }
    })
  })

  describe('delete → soft delete 변환 (redirect to update, hard delete 차단)', () => {
    it('delete — update { deletedAt: NOW() } 로 redirect', () => {
      const d = decideAuthorSoftDelete('delete', { where: { id: 'author-1' } }, FIXED_NOW)

      expect(d.kind).toBe('redirect')
      if (d.kind !== 'redirect') throw new Error('unreachable')
      expect(d.redirectTo).toBe('update')
      expect(d.args.where).toEqual({ id: 'author-1' })
      expect((d.args.data as { deletedAt: Date }).deletedAt).toEqual(FIXED_NOW)
    })

    it('deleteMany — updateMany { deletedAt: NOW() } 로 redirect', () => {
      const d = decideAuthorSoftDelete('deleteMany', { where: { role: 'user' } }, FIXED_NOW)

      expect(d.kind).toBe('redirect')
      if (d.kind !== 'redirect') throw new Error('unreachable')
      expect(d.redirectTo).toBe('updateMany')
      expect(d.args.where).toEqual({ role: 'user' })
      expect((d.args.data as { deletedAt: Date }).deletedAt).toEqual(FIXED_NOW)
    })

    it('deleteMany — where 미지정 시 빈 객체로 redirect', () => {
      const d = decideAuthorSoftDelete('deleteMany', undefined, FIXED_NOW)

      expect(d.kind).toBe('redirect')
      if (d.kind !== 'redirect') throw new Error('unreachable')
      expect(d.args.where).toEqual({})
    })
  })

  describe('비-조회/비-삭제 액션 → passthrough (변환 0건)', () => {
    it('create — passthrough', () => {
      expect(decideAuthorSoftDelete('create', { data: {} }, FIXED_NOW).kind).toBe('passthrough')
    })

    it('update — passthrough (softDelete/restore 명시 update 보존)', () => {
      expect(decideAuthorSoftDelete('update', { where: { id: 'x' } }, FIXED_NOW).kind).toBe(
        'passthrough',
      )
    })

    it('upsert — passthrough', () => {
      expect(decideAuthorSoftDelete('upsert', {}, FIXED_NOW).kind).toBe('passthrough')
    })
  })

  describe('includeDeleted: true 우회 (운영자 영역)', () => {
    it('findFirst — includeDeleted: true 면 deletedAt 필터 미적용 + flag 제거', () => {
      const d = decideAuthorSoftDelete(
        'findFirst',
        { where: { id: 'author-1', includeDeleted: true } },
        FIXED_NOW,
      )

      expect(d.kind).toBe('filtered')
      if (d.kind !== 'filtered') throw new Error('unreachable')
      // includeDeleted flag 제거 + deletedAt 필터 미적용
      expect(d.args.where).toEqual({ id: 'author-1' })
      expect((d.args.where as Record<string, unknown>).deletedAt).toBeUndefined()
    })
  })

  describe('withSoftDeleteFilter 순수 함수', () => {
    it('args undefined — where: { deletedAt: null } 생성', () => {
      expect(withSoftDeleteFilter(undefined)).toEqual({ where: { deletedAt: null } })
    })

    it('기존 where 보존 + deletedAt: null 병합', () => {
      expect(withSoftDeleteFilter({ where: { id: 'x' }, take: 5 })).toEqual({
        where: { id: 'x', deletedAt: null },
        take: 5,
      })
    })

    it('원본 args 를 변형하지 않는다 (불변성)', () => {
      const original = { where: { id: 'x' } }
      withSoftDeleteFilter(original)
      expect(original).toEqual({ where: { id: 'x' } })
    })
  })
})
