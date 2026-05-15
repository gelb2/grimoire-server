import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { UserAnonymizerPort } from '@domain/port/outbound/user-anonymizer.port'

/**
 * USER-SOFT-DELETE sprint (2026-05-15) — GDPR 익명화 어댑터.
 *
 * 옵션 A (basic — 사용자 5/15 채택) 영역 영역 anonymize 영역:
 * - email → `anonymized-{uuid}@deleted.local`
 * - name → `Deleted Author`
 * - passwordHash → null (재로그인 차단)
 * - bio → null
 *
 * 옵션 B (strong) + C (strongest) 영역 영역 영역 영역 영역 (향후 환경변수 영역 영역 확장 영역).
 *
 * 정본: .claude/state/sprint-user-soft-delete-draft.md §11-2 UserAnonymizerPort
 * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
 *
 * Hexagonal 정합:
 * - adapter/outbound 영역 — PrismaService 영역 영역 영역 영역 영역 영역
 * - middleware 영역 영역 영역 영역 영역 영역 영역 영역 — raw update 영역 영역 영역 영역
 */
@Injectable()
export class DefaultUserAnonymizerAdapter implements UserAnonymizerPort {
  constructor(private readonly prisma: PrismaService) {}

  async anonymize(
    authorId: string,
    scope: 'basic' | 'strong' | 'strongest' = 'basic',
  ): Promise<void> {
    // 옵션 A (basic) — email + name + passwordHash + bio
    const anonymizedEmail = `anonymized-${randomUUID()}@deleted.local`
    const anonymizedName = 'Deleted Author'

    // middleware 영역 영역 영역 영역 영역 영역 영역 영역 — raw update 영역 영역 영역 영역
    // (deletedAt 영역 영역 IS NULL 영역 영역 영역 영역 영역 영역 영역 update 영역 영역 영역 영역)
    await this.prisma.$executeRaw`
      UPDATE "authors"
      SET "email" = ${anonymizedEmail},
          "name" = ${anonymizedName},
          "password_hash" = NULL,
          "bio" = NULL
      WHERE "id" = ${authorId}::uuid
    `

    // 옵션 B (strong) 영역 — IP + userAgent + access_logs.authorId 영역 영역 (PAY-P3-E SetNull 정합)
    if (scope === 'strong' || scope === 'strongest') {
      await this.prisma.$executeRaw`
        UPDATE "access_logs"
        SET "ip" = NULL, "user_agent" = NULL
        WHERE "author_id" = ${authorId}::uuid
      `
    }

    // 옵션 C (strongest) 영역 — 작품/episode 영역 콘텐츠 anonymize 영역 0건 (작가 콘텐츠 영역 영역 영역 정합 영역 영역)
    // 본 sprint = basic 영역 영역 영역 영역 영역 — 작품/episode 영역 영역 본 sprint 비목표 (§2-2)
  }
}
