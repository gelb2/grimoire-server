import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { AuthTokenRepositoryPort } from '@domain/port/outbound/auth-token-repository.port'
import { UserAnonymizerPort } from '@domain/port/outbound/user-anonymizer.port'
import { AuditLogService } from '@application/admin/audit-log.service'
import { SoftDeletedBy } from '@domain/model/user-soft-delete-state'
import { loadUserSoftDeletePolicy } from '@domain/policy/user-soft-delete-policy'

/**
 * USER-SOFT-DELETE sprint (2026-05-15) — Author soft delete usecase 영역.
 *
 * 흐름:
 * 1. 대상 Author 영역 영역 조회 영역 (deletedAt = null 영역 영역 검증)
 * 2. softDelete (deletedAt = NOW)
 * 3. UserAnonymizer 영역 영역 GDPR 익명화 영역 (basic 옵션 A)
 * 4. RefreshToken 영역 영역 즉시 무효 영역 (PAY-P3-E Cascade 영역 정합 강화)
 * 5. AdminAuditLog 영역 영역 박제 (PAY-P2-4 6-arg 정합)
 *    - self → 'self_account_delete'
 *    - admin → 'admin_force_delete' (사유 영역 필수)
 *    - gdpr 영역 → 'gdpr_anonymize'
 *
 * 정본: .claude/state/sprint-user-soft-delete-draft.md §5-4 Hexagonal 흐름 매트릭스
 * 정본: .claude/shared-contracts.md §29 UserSoftDeletePolicy
 */
@Injectable()
export class UserSoftDeleteUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('AuthTokenRepositoryPort') private readonly authTokenRepo: AuthTokenRepositoryPort,
    @Inject('UserAnonymizerPort') private readonly userAnonymizer: UserAnonymizerPort,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Author soft delete + GDPR 익명화 + RefreshToken 즉시 무효 영역 영역 영역 영역.
   *
   * @param authorId 대상 Author ID
   * @param deletedBy 'self' (본인 탈퇴) | 'admin' (운영자 강제 삭제)
   * @param adminId 운영자 ID (admin 영역 필수)
   * @param reason 사유 (admin 영역 영역 필수, self 영역 영역 영역)
   */
  async execute(
    authorId: string,
    deletedBy: SoftDeletedBy,
    adminId?: string,
    reason?: string,
  ): Promise<void> {
    // 0. 입력 검증
    if (deletedBy === 'admin') {
      if (!adminId) throw new BadRequestException('운영자 강제 삭제 시 adminId 필수')
      if (!reason || reason.trim().length === 0) {
        throw new BadRequestException('운영자 강제 삭제 시 사유 필수')
      }
    }

    // 1. 대상 Author 영역 영역 조회 영역 (deletedAt = null 영역 영역 검증)
    const author = await this.authorRepo.findById(authorId)
    if (!author) {
      throw new NotFoundException('작가를 찾을 수 없습니다')
    }

    // 운영자 영역 영역 본인 영역 영역 강제 영역 영역 차단 영역 (실수 영역 차단)
    if (deletedBy === 'admin' && adminId === authorId) {
      throw new ForbiddenException('운영자는 본인 계정을 강제 삭제할 수 없습니다 (self 영역 영역 영역 영역)')
    }

    // admin 영역 영역 영역 영역 영역 admin 계정 영역 영역 차단 영역 (PAY-P3-E AdminAuditLog Restrict 영역 정합 강제)
    if (deletedBy === 'admin' && author.role === 'admin') {
      throw new BadRequestException('관리자 계정은 강제 삭제할 수 없습니다')
    }

    const beforeState = {
      id: author.id,
      slug: author.slug,
      role: author.role,
      deletedAt: author.deletedAt,
    }

    // 2. softDelete (deletedAt = NOW)
    await this.authorRepo.softDelete(authorId)

    // 3. GDPR 익명화 영역 (옵션 A basic — 사용자 5/15 채택)
    const policy = loadUserSoftDeletePolicy()
    await this.userAnonymizer.anonymize(authorId, policy.anonymizeScope)

    // 4. RefreshToken 영역 영역 즉시 무효 영역 (PAY-P3-E Cascade 영역 정합 강화)
    await this.authTokenRepo.revokeAllByAuthorId(authorId)

    // 5. AdminAuditLog 영역 영역 박제 (PAY-P2-4 6-arg)
    const action = deletedBy === 'self' ? 'self_account_delete' : 'admin_force_delete'
    const actorId = deletedBy === 'self' ? authorId : adminId!
    await this.auditLog.log(
      actorId,
      action,
      authorId,
      { deletedBy, reason: reason ?? null, anonymizeScope: policy.anonymizeScope },
      beforeState,
      { deletedAt: new Date().toISOString() },
    )

    // 6. GDPR 익명화 영역 별도 audit log (PII 영역 처리 영역 영역 영역 박제 영역)
    await this.auditLog.log(
      actorId,
      'gdpr_anonymize',
      authorId,
      { scope: policy.anonymizeScope },
    )
  }

  /**
   * 운영자 GDPR 익명화 only 분기 영역 (qa #20 server-web 정합 영역 영역 영역 보강 — 사용자 5/15 옵션 A 채택).
   *
   * Soft delete 영역 영역 영역 영역 — GDPR Article 17 (Right to Erasure) 영역 정합 영역
   * 영역 영역 영역 식별 영역 영역 영역 익명화 영역 (계정 영역 유지 영역).
   *
   * 흐름:
   * 1. 대상 Author 영역 조회 (존재 검증, deletedAt 이미 영역 시 BadRequestException — idempotent X)
   * 2. UserAnonymizer 영역 anonymize (email + name + passwordHash + bio 4 필드만)
   * 3. AdminAuditLog gdpr_anonymize action 박제 (사유 + adminId + targetId)
   *
   * 정합 매트릭스 (execute 영역 영역 영역 비교 영역):
   * - soft delete (deletedAt = NOW) → X (계정 유지)
   * - RefreshToken revoke → X (탈퇴 영역 영역 영역 영역)
   * - anonymize → O (basic 영역 영역)
   * - admin_force_delete audit → X (gdpr_anonymize 영역 영역만 박제)
   *
   * @param authorId 대상 Author ID
   * @param adminId 운영자 ID (필수)
   * @param reason 사유 (필수)
   * @returns anonymize 박제 시각 (ISO 8601)
   */
  async anonymizeOnly(
    authorId: string,
    adminId: string,
    reason: string,
  ): Promise<{ anonymizedAt: string }> {
    // 0. 입력 검증
    if (!adminId) {
      throw new BadRequestException('운영자 GDPR 익명화 시 adminId 필수')
    }
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('운영자 GDPR 익명화 시 사유 필수')
    }

    // 1. 대상 Author 영역 조회 (middleware 영역 영역 — deletedAt = null 영역 영역 결과)
    const author = await this.authorRepo.findById(authorId)
    if (!author) {
      throw new NotFoundException('작가를 찾을 수 없습니다')
    }

    // 운영자 영역 본인 영역 영역 익명화 영역 차단 (실수 영역 차단 — execute 영역 정합)
    if (adminId === authorId) {
      throw new ForbiddenException('운영자는 본인 계정을 익명화할 수 없습니다')
    }

    // admin 영역 영역 admin 계정 익명화 차단 (PAY-P3-E AdminAuditLog Restrict 영역 정합 강제)
    if (author.role === 'admin') {
      throw new BadRequestException('관리자 계정은 익명화할 수 없습니다')
    }

    const beforeState = {
      id: author.id,
      slug: author.slug,
      email: author.email,
      name: author.name,
    }

    // 2. GDPR 익명화 영역 (옵션 A basic 영역 — 사용자 5/15 채택)
    const policy = loadUserSoftDeletePolicy()
    await this.userAnonymizer.anonymize(authorId, policy.anonymizeScope)

    const anonymizedAt = new Date().toISOString()

    // 3. AdminAuditLog gdpr_anonymize action 박제 (PAY-P2-4 6-arg)
    await this.auditLog.log(
      adminId,
      'gdpr_anonymize',
      authorId,
      { reason, scope: policy.anonymizeScope, mode: 'anonymize_only' },
      beforeState,
      { anonymizedAt },
    )

    return { anonymizedAt }
  }
}
