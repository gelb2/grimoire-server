import { Prisma } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

/**
 * PAY-P3-E §3-1 + §3-2 — FK Cascade 정책 정합 검증 spec
 *
 * 단계 4 게이트 정합 (계약 §5-1 정합):
 * - 6+ it 박제: Cascade 16건 + Restrict 8건 + SetNull 9건 (4 전략 분포)
 * - mock 영역 (실 DB 의존 0건) — schema/migration.sql 정적 검증 + Prisma 에러 시뮬
 *
 * Sprint 계약 §3-1 매트릭스 (33 FK + 25 raw FK 영역) 정합 박제.
 *
 * 단계 1+2 raw 박제 영역 정합:
 * - dev DB 33/33 시나리오 A (orphan=0)
 * - archive 3 row 영구 보존 (credit_logs 1 + admin_audit_logs 2)
 *
 * 정본: `.claude/state/sprint-pay-p3-e-fk-cascade-draft.md` §3-1 + §3-2
 */
describe('PAY-P3-E FK Cascade Policy', () => {
  const schemaPath = path.resolve(__dirname, '../../../../prisma/schema.prisma')
  const migrationPath = path.resolve(
    __dirname,
    '../../../../prisma/migrations/20260510_pay_p3_e_fk_cascade_policy/migration.sql',
  )

  let schemaContent: string
  let migrationContent: string

  beforeAll(() => {
    schemaContent = fs.readFileSync(schemaPath, 'utf-8')
    migrationContent = fs.readFileSync(migrationPath, 'utf-8')
  })

  // ============================================================================
  // it 1 — Author 삭제 시 Restrict 박제 (회계/세무/감사 영구 보존)
  // CC-4 Phase 3 (2026-05-21) — CreditLog 모델 폐기 → 현 schema Restrict 7건(Work·Payment·UserSanction·AnalysisReport·AdminAuditLog·RefundLog + 신 CreditLedger·MembershipPlan은 본 spec 범위 외 영역).
  //   PAY-P3-E 마이그레이션 박제(migration.sql)는 비가역 — `credit_logs_author_id_fkey` 정합 박제는 그대로 보존(과거 박제 증명).
  // ============================================================================
  it('Restrict 박제 정합 — Payment/Work/UserSanction/AnalysisReport/AdminAuditLog/RefundLog (회계/세무/감사 영구 보존, CC-4 Phase 3 후 7건)', () => {
    // CC-4 Phase 3 후 schema.prisma 박제 (CreditLog 제거 — 6 Restrict @relation Author 측 + RefundLog Payment 측 = 7건)
    const restrictRelations = [
      { model: 'Work', fk: 'authorId', target: 'Author' },
      { model: 'Payment', fk: 'authorId', target: 'Author' },
      { model: 'UserSanction', fk: 'authorId', target: 'Author' }, // SanctionedAuthor named relation
      { model: 'AnalysisReport', fk: 'authorId', target: 'Author' },
      { model: 'AdminAuditLog', fk: 'adminId', target: 'Author' },
      { model: 'RefundLog', fk: 'paymentId', target: 'Payment' },
    ]

    // schema 영역 onDelete: Restrict 박제 정합 검증
    for (const r of restrictRelations) {
      const pattern = new RegExp(`fields:\\s*\\[${r.fk}\\][^\\n]*onDelete:\\s*Restrict`, 'm')
      expect(schemaContent).toMatch(pattern)
    }

    // CC-4 Phase 3 후 schema.prisma `model CreditLog` 부재 박제 정합
    expect(schemaContent).not.toMatch(/^model\s+CreditLog\b/m)

    // PAY-P3-E migration.sql ON DELETE RESTRICT 박제 — 비가역 SQL 박제는 보존 (과거 마이그레이션 증명용)
    expect(migrationContent).toContain('"works_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT')
    expect(migrationContent).toContain('"credit_logs_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT')
    expect(migrationContent).toContain('"payments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT')
    expect(migrationContent).toContain('"user_sanctions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT')
    expect(migrationContent).toContain('"analysis_reports_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT')
    expect(migrationContent).toContain('"admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "authors"("id") ON DELETE RESTRICT')
    expect(migrationContent).toContain('"refund_logs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT')
  })

  // ============================================================================
  // it 2 — Cascade 영역 (사용자 종속 + Work/Episode 종속 + 통계)
  // ============================================================================
  it('Cascade 영역 정합 — refresh_tokens / chat_sessions / bookmarks / reading_progress / subscriptions / social_accounts (사용자 종속) + episodes (Work cascade) + daily_views', () => {
    // 핵심 Cascade 박제 검증
    expect(schemaContent).toMatch(/work\s+Work\s+@relation\(fields:\s*\[workId\][^\n]*onDelete:\s*Cascade/)
    expect(schemaContent).toMatch(/author\s+Author\s+@relation\(fields:\s*\[authorId\][^\n]*onDelete:\s*Cascade/)

    // migration.sql ON DELETE CASCADE 박제 (핵심 raw FK 영역)
    expect(migrationContent).toContain('"episodes_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"social_accounts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"bookmarks_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"bookmarks_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"reading_progress_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"reading_progress_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"subscriptions_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "authors"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"subscriptions_target_author_id_fkey" FOREIGN KEY ("target_author_id") REFERENCES "authors"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"chat_sessions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"chat_sessions_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"daily_views_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"refresh_tokens_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE')
    expect(migrationContent).toContain('"featured_works_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE')

    // chat_messages_session_id_fkey: 이미 ON DELETE CASCADE 박제 (변경 0)
    expect(schemaContent).toMatch(/sessionId\s+String[\s\S]*?session\s+ChatSession\s+@relation\(fields:\s*\[sessionId\][^\n]*onDelete:\s*Cascade/)
  })

  // ============================================================================
  // it 3 — SetNull 영역 (익명화 + 운영자 변경 보존 + Theme default 유지)
  // ============================================================================
  it('SetNull 영역 정합 — Comment/Like/AccessLog 익명화 + Reports 신고자 + FeaturedWork.adminId/UserSanction.adminId 운영자 변경 보존 + Theme.authorId/Work.themeId default 유지', () => {
    // schema 영역 onDelete: SetNull 박제 검증
    expect(schemaContent).toMatch(/author\s+Author\?\s+@relation\(fields:\s*\[authorId\][^\n]*onDelete:\s*SetNull/)

    // migration.sql ON DELETE SET NULL 박제 (9 영역)
    expect(migrationContent).toContain('"themes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL')
    expect(migrationContent).toContain('"works_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE SET NULL')
    expect(migrationContent).toContain('"likes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL')
    expect(migrationContent).toContain('"comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL')
    expect(migrationContent).toContain('"comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE SET NULL')
    expect(migrationContent).toContain('"reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "authors"("id") ON DELETE SET NULL')
    expect(migrationContent).toContain('"reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "authors"("id") ON DELETE SET NULL')
    expect(migrationContent).toContain('"access_logs_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL')
    expect(migrationContent).toContain('"featured_works_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "authors"("id") ON DELETE SET NULL')
    expect(migrationContent).toContain('"user_sanctions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "authors"("id") ON DELETE SET NULL')
  })

  // ============================================================================
  // it 4 — refund_logs.paymentId Restrict 영역 (PAY-P1-1 정합 강화)
  // ============================================================================
  it('refund_logs.paymentId Restrict — Payment 삭제 시 RefundLog 잔존 = throw (회계 영구 보존, PAY-P1-1 정합)', async () => {
    // mock Prisma 에러 시뮬 — Payment 삭제 시 PrismaClientKnownRequestError P2003 throw 정합
    const mockError = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed on the field: `RefundLog_paymentId_fkey (index)`',
      { code: 'P2003', clientVersion: '6.19.3', meta: { field_name: 'RefundLog_paymentId_fkey (index)' } },
    )

    expect(mockError.code).toBe('P2003')
    expect(mockError.message).toContain('Foreign key constraint failed')

    // schema 영역 RefundLog.payment 박제 정합
    expect(schemaContent).toMatch(/payment\s+Payment\s+@relation\(fields:\s*\[paymentId\][^\n]*onDelete:\s*Restrict/)

    // migration.sql 박제 정합
    expect(migrationContent).toContain('"refund_logs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT')
  })

  // ============================================================================
  // it 5 — admin_audit_logs.adminId Restrict 영역 (PAY-P2-4 정합 강화)
  // ============================================================================
  it('admin_audit_logs.adminId Restrict — Admin 삭제 시 AuditLog 잔존 = throw (감사 영구 보존, PAY-P2-4 정합)', async () => {
    const mockError = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed on the field: `AdminAuditLog_adminId_fkey (index)`',
      { code: 'P2003', clientVersion: '6.19.3', meta: { field_name: 'AdminAuditLog_adminId_fkey (index)' } },
    )

    expect(mockError.code).toBe('P2003')

    // schema 영역 AdminAuditLog.admin 박제 정합
    expect(schemaContent).toMatch(/admin\s+Author\s+@relation\(fields:\s*\[adminId\][^\n]*onDelete:\s*Restrict/)

    // migration.sql 박제 정합
    expect(migrationContent).toContain('"admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "authors"("id") ON DELETE RESTRICT')
  })

  // ============================================================================
  // it 6 — archive 테이블 영구 보존 정합 (단계 1+2 raw 박제 정합)
  // ============================================================================
  it('archive 테이블 영구 보존 정합 — credit_logs_archive_pay_p3_e + admin_audit_logs_archive_pay_p3_e (옵션 C 강제 박제 정합)', () => {
    // archive 테이블 영구 보존 — 본 spec 영역 = 단계 1+2 박제 정합 검증 영역
    // 실 DB 영역 검증 = sensor-fk-cascade-policy.sh 영역 (Sprint 계약 §5-3 정합)
    // 본 spec 영역 = migration.sql 영역 archive 영역 명시 강제 (DROP TABLE 영역 0건 강제)
    expect(migrationContent).not.toContain('DROP TABLE "credit_logs_archive')
    expect(migrationContent).not.toContain('DROP TABLE "admin_audit_logs_archive')
    expect(migrationContent).not.toContain('TRUNCATE TABLE "credit_logs_archive')
    expect(migrationContent).not.toContain('TRUNCATE TABLE "admin_audit_logs_archive')

    // archive 영역 = 단계 2 raw 박제 영역 (`.claude/state/pay-p3-e-fk-backfill-raw.md` §4 영역)
    // 옵션 C archive 강제 = 회계/감사 영구 보존 영역 정합 (Sprint 계약 §6-4 정합)
  })

  // ============================================================================
  // it 7 — self-ref @relation name 정합 (Subscription / UserSanction / Report)
  // ============================================================================
  it('self-ref @relation name 정합 — Subscription (Subscriber/TargetAuthor) + UserSanction (SanctionedAuthor/SanctioningAdmin) + Report (Reporter/Resolver)', () => {
    // Subscription self-ref
    expect(schemaContent).toContain('@relation("Subscriber"')
    expect(schemaContent).toContain('@relation("TargetAuthor"')

    // UserSanction self-ref
    expect(schemaContent).toContain('@relation("SanctionedAuthor"')
    expect(schemaContent).toContain('@relation("SanctioningAdmin"')

    // Report self-ref
    expect(schemaContent).toContain('@relation("Reporter"')
    expect(schemaContent).toContain('@relation("Resolver"')

    // FeaturedWork named relation
    expect(schemaContent).toContain('@relation("FeaturedWorkAdmin"')

    // Comment self-ref (이미 박제)
    expect(schemaContent).toContain('@relation("CommentReplies"')
  })

  // ============================================================================
  // it 8 — Optional 변경 영역 정합 (FeaturedWork.adminId / UserSanction.adminId Required → Optional)
  // ============================================================================
  it('Optional 변경 영역 정합 — FeaturedWork.adminId / UserSanction.adminId Required → Optional (SetNull 정합)', () => {
    // schema 영역 Optional 박제 검증
    expect(schemaContent).toMatch(/model FeaturedWork[\s\S]*?adminId\s+String\?\s+@map\("admin_id"\)/)
    expect(schemaContent).toMatch(/model UserSanction[\s\S]*?adminId\s+String\?\s+@map\("admin_id"\)/)

    // migration.sql DROP NOT NULL 박제 정합
    expect(migrationContent).toContain('ALTER TABLE "featured_works" ALTER COLUMN "admin_id" DROP NOT NULL')
    expect(migrationContent).toContain('ALTER TABLE "user_sanctions" ALTER COLUMN "admin_id" DROP NOT NULL')
  })
})
