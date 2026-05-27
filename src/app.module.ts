import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'

// 인프라
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { BlobStorageService } from '@infrastructure/storage/blob-storage.service'
import { GcsStorageService } from '@infrastructure/storage/gcs-storage.service'
import { SemanticCacheService } from '@lib/semantic-cache'
// EMAIL-POLAR-READY Phase B (2026-05-27) — Email 어댑터 factory.
// 사용자 절대 규정 0-1 정합 — default 시 NullEmailAdapter 반환, env EMAIL_PROVIDER 분기.
import { createEmailService } from '@infrastructure/email/email.factory'

// 유스케이스
import { GenerateThemeUseCase } from '@application/theme/generate-theme.usecase'
import { GetThemeUseCase } from '@application/theme/get-theme.usecase'
import { BakeThemeUseCase } from '@application/theme/bake-theme.usecase'
import { ParseManuscriptUseCase } from '@application/manuscript/parse-manuscript.usecase'
import { CreditUseCase } from '@application/credit/credit.usecase'
// 크레딧 개편 I Phase (2026-05-17) — 디노미네이션 + 4구간 차감 + 구독 월 풀
import { ChargePointsUseCase } from '@application/credit/charge-points.usecase'
import { GrantPointsUseCase } from '@application/credit/grant-points.usecase'
import { ResetMonthlyPoolJob } from '@application/subscription/reset-monthly-pool.job'
// 크레딧 개편 CC-5 (2026-05-22, PAY-P1-4) — Polar 구독 webhook + checkout/멤버십 조회
import { ProcessSubscriptionWebhookUseCase } from '@application/subscription/process-subscription-webhook.usecase'
import { StartSubscriptionUseCase } from '@application/subscription/start-subscription.usecase'
import { GetMembershipUseCase } from '@application/subscription/get-membership.usecase'
import { AuthorUseCase } from '@application/author/author.usecase'
import { ContentUseCase } from '@application/content/content.usecase'
import { AuthUseCase } from '@application/auth/auth.usecase'
// EMAIL-POLAR-READY Phase C+D (2026-05-27) — 이메일 인증 UseCase + 결제 알림 UseCase.
import { EmailVerificationUseCase } from '@application/auth/email-verification.usecase'
import { PaymentNotificationUseCase } from '@application/payment/payment-notification.usecase'
import { WorkManagementUseCase } from '@application/work/work-management.usecase'
import { PaymentUseCase } from '@application/payment/payment.usecase'
import { PaymentReconciliationJob } from '@application/payment/payment-reconciliation.job'
import { PaymentCleanupJob } from '@application/payment/payment-cleanup.job'
import { WebhookRetryJob } from '@application/payment/webhook-retry.job'
import { RefundPaymentUseCase } from '@application/payment/refund-payment.usecase'
import { ReaderUseCase } from '@application/reader/reader.usecase'
import { DiscoveryUseCase } from '@application/discovery/discovery.usecase'
import { AdminUseCase } from '@application/admin/admin.usecase'
import { AuditLogService } from '@application/admin/audit-log.service'
import { AuditMaskJob } from '@application/admin/audit-mask.job'
import { AccessLogService } from '@infrastructure/security/access-log.service'
import { UserSoftDeleteUseCase } from '@application/author/user-soft-delete.usecase'
import { UserHardDeleteJob } from '@application/author/user-hard-delete.job'
import { DefaultUserAnonymizerAdapter } from '@adapter/outbound/persistence/default-user-anonymizer.adapter'
import { ThemeSlotUseCase } from '@application/theme/theme-slot.usecase'
import { PlanUseCase } from '@application/plan/plan.usecase'
import { NovelAnalysisUseCase } from '@application/analysis/novel-analysis.usecase'
import { ChatUseCase } from '@application/chat/chat.usecase'
import { SocialUseCase } from '@application/social/social.usecase'
import { StatsUseCase } from '@application/stats/stats.usecase'

// 컨트롤러
import { HealthController } from '@adapter/inbound/http/controller/health.controller'
import { ThemeController } from '@adapter/inbound/http/controller/theme.controller'
import { ManuscriptController } from '@adapter/inbound/http/controller/manuscript.controller'
import { AuthorController } from '@adapter/inbound/http/controller/author.controller'
import { ContentController } from '@adapter/inbound/http/controller/content.controller'
import { AuthController } from '@adapter/inbound/http/controller/auth.controller'
import { WorkManagementController, EpisodeManagementController } from '@adapter/inbound/http/controller/work-management.controller'
import { PaymentController } from '@adapter/inbound/http/controller/payment.controller'
import { ReaderController } from '@adapter/inbound/http/controller/reader.controller'
import { DiscoveryController } from '@adapter/inbound/http/controller/discovery.controller'
import { AdminController } from '@adapter/inbound/http/controller/admin.controller'
import { AnalysisController } from '@adapter/inbound/http/controller/analysis.controller'
import { SocialController } from '@adapter/inbound/http/controller/social.controller'
import { StatsController } from '@adapter/inbound/http/controller/stats.controller'
import { CreditController } from '@adapter/inbound/http/controller/credit.controller'
import { PlanController } from '@adapter/inbound/http/controller/plan.controller'
import { ChatController } from '@adapter/inbound/http/controller/chat.controller'
// 크레딧 개편 CC-5 (2026-05-22, PAY-P1-4) — 구독 정기결제 컨트롤러
import { SubscriptionController } from '@adapter/inbound/http/controller/subscription.controller'

// 아웃바운드 어댑터
import { PrismaAuthorRepository } from '@adapter/outbound/persistence/prisma-author.repository'
import { PrismaThemeRepository } from '@adapter/outbound/persistence/prisma-theme.repository'
import { PrismaWorkRepository } from '@adapter/outbound/persistence/prisma-work.repository'
// CC-4 Phase 3 (2026-05-21) — `PrismaCreditRepository`/`CreditRepositoryPort` 파일 자체 삭제. 신 `CreditLedgerPort` 단일 경로.
// 크레딧 개편 I Phase (2026-05-17) — CreditLedger 원장 / MembershipPlan 구독 / SystemSetting 동적값
import { PrismaCreditLedgerRepository } from '@adapter/outbound/persistence/prisma-credit-ledger.repository'
import { PrismaMembershipPlanRepository } from '@adapter/outbound/persistence/prisma-membership-plan.repository'
import { PrismaSystemSettingRepository } from '@adapter/outbound/persistence/prisma-system-setting.repository'
import { PrismaReaderRepository } from '@adapter/outbound/persistence/prisma-reader.repository'
import { PrismaSocialRepository } from '@adapter/outbound/persistence/prisma-social.repository'
import { PrismaStatsRepository } from '@adapter/outbound/persistence/prisma-stats.repository'
import { PrismaChatRepository } from '@adapter/outbound/persistence/prisma-chat.repository'
import { PrismaAuditLogRepository } from '@adapter/outbound/persistence/prisma-audit-log.repository'
import { PrismaAuthTokenRepository } from '@adapter/outbound/persistence/prisma-auth-token.repository'
import { PrismaSignupHistoryRepository } from '@adapter/outbound/persistence/prisma-signup-history.repository'
import { PrismaAdminRepository } from '@adapter/outbound/persistence/prisma-admin.repository'
import { PrismaPaymentRepository } from '@adapter/outbound/persistence/prisma-payment.repository'
// EMAIL-POLAR-READY Phase C (2026-05-27) — 이메일 인증 토큰 영역.
import { PrismaEmailVerificationTokenRepository } from '@adapter/outbound/persistence/prisma-email-verification-token.repository'
import { PrismaWebhookEventRepository } from '@adapter/outbound/persistence/prisma-webhook-event.repository'
import { PrismaWebhookRetryQueueRepository } from '@adapter/outbound/persistence/prisma-webhook-retry-queue.repository'
import { PrismaReconciliationCheckpointRepository } from '@adapter/outbound/persistence/prisma-reconciliation-checkpoint.repository'
import { PrismaAnalysisReportRepository } from '@adapter/outbound/persistence/prisma-analysis-report.repository'
import { ClaudeThemeAdapter } from '@adapter/outbound/ai/claude-theme.adapter'
import { OpenAIEmbeddingAdapter } from '@adapter/outbound/embedding/openai-embedding.adapter'
import { PgVectorAdapter } from '@adapter/outbound/vector/pgvector.adapter'
import { PolarAdapter } from '@adapter/outbound/payment/polar.adapter'
import { InMemoryCircuitBreakerAdapter } from '@adapter/outbound/circuit-breaker/in-memory-circuit-breaker.adapter'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'
import { AdminGuard } from '@adapter/inbound/http/guard/admin.guard'

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '15m' },
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,   // 기본: 1분
      limit: 60,    // 기본: 분당 60회
    }]),
    // Sprint PAY-P0-2 — @Cron 기반 PG↔DB 정합성 검증 cron
    ScheduleModule.forRoot(),
  ],
  controllers: [
    HealthController,
    ThemeController,
    ManuscriptController,
    AuthorController,
    ContentController,
    AuthController,
    WorkManagementController,
    EpisodeManagementController,
    PaymentController,
    ReaderController,
    DiscoveryController,
    AdminController,
    AnalysisController,
    SocialController,
    StatsController,
    CreditController,
    PlanController,
    ChatController,
    SubscriptionController,
  ],
  providers: [
    // 인프라
    PrismaService,
    BlobStorageService,
    GcsStorageService,
    SemanticCacheService,

    // 유스케이스
    GenerateThemeUseCase,
    GetThemeUseCase,
    BakeThemeUseCase,
    ParseManuscriptUseCase,
    CreditUseCase,
    // 크레딧 개편 I Phase (2026-05-17) — 디노미네이션 차감/적립 usecase + 월 풀 리셋 cron
    ChargePointsUseCase,
    GrantPointsUseCase,
    ResetMonthlyPoolJob,
    // 크레딧 개편 CC-5 (2026-05-22, PAY-P1-4) — Polar 구독 정기결제 연동
    ProcessSubscriptionWebhookUseCase,
    StartSubscriptionUseCase,
    GetMembershipUseCase,
    AuthorUseCase,
    ContentUseCase,
    AuthUseCase,
    // EMAIL-POLAR-READY Phase C+D (2026-05-27) — 이메일 인증 + 결제 알림 use case.
    EmailVerificationUseCase,
    PaymentNotificationUseCase,
    WorkManagementUseCase,
    PaymentUseCase,
    PaymentReconciliationJob,
    PaymentCleanupJob,
    WebhookRetryJob,
    RefundPaymentUseCase,
    ReaderUseCase,
    DiscoveryUseCase,
    AdminUseCase,
    AuditLogService,
    AuditMaskJob,
    AccessLogService,
    // USER-SOFT-DELETE sprint (2026-05-15) — Author soft delete usecase + cron + GDPR anonymizer
    UserSoftDeleteUseCase,
    UserHardDeleteJob,
    ThemeSlotUseCase,
    PlanUseCase,
    NovelAnalysisUseCase,
    ChatUseCase,
    SocialUseCase,
    StatsUseCase,
    JwtAuthGuard,
    AdminGuard,

    // 글로벌 Rate Limiting 가드
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    // 포트 → 어댑터 바인딩 (토큰 기반 DI)
    { provide: 'AuthorRepositoryPort', useClass: PrismaAuthorRepository },
    { provide: 'ThemeRepositoryPort', useClass: PrismaThemeRepository },
    { provide: 'WorkRepositoryPort', useClass: PrismaWorkRepository },
    // CC-4 Phase 3 (2026-05-21) — `CreditRepositoryPort` DI 제거 (신 `CreditLedgerPort` 단일 경로).
    // 크레딧 개편 I Phase (2026-05-17) — CreditLedger 원장 / MembershipPlan 구독 / SystemSetting 동적값
    { provide: 'CreditLedgerPort', useClass: PrismaCreditLedgerRepository },
    { provide: 'MembershipPlanPort', useClass: PrismaMembershipPlanRepository },
    { provide: 'SystemSettingRepositoryPort', useClass: PrismaSystemSettingRepository },
    { provide: 'ReaderRepositoryPort', useClass: PrismaReaderRepository },
    { provide: 'ClaudeApiPort', useClass: ClaudeThemeAdapter },
    { provide: 'SocialRepositoryPort', useClass: PrismaSocialRepository },
    { provide: 'StatsRepositoryPort', useClass: PrismaStatsRepository },
    { provide: 'EmbeddingPort', useClass: OpenAIEmbeddingAdapter },
    { provide: 'VectorStorePort', useClass: PgVectorAdapter },
    // PAY-P3-H: Circuit Breaker DI 바인딩 (PolarAdapter보다 먼저 박제 강제 — 주입 의무).
    // 정본: shared-contracts §27 CircuitBreakerPolicy, ADR-009.
    { provide: 'CircuitBreakerPort', useClass: InMemoryCircuitBreakerAdapter },
    { provide: 'PaymentGatewayPort', useClass: PolarAdapter },
    { provide: 'ChatRepositoryPort', useClass: PrismaChatRepository },
    { provide: 'BlobStoragePort', useClass: GcsStorageService },
    { provide: 'AuditLogRepositoryPort', useClass: PrismaAuditLogRepository },
    { provide: 'AuthTokenRepositoryPort', useClass: PrismaAuthTokenRepository },
    { provide: 'SignupHistoryRepositoryPort', useClass: PrismaSignupHistoryRepository },
    { provide: 'AdminRepositoryPort', useClass: PrismaAdminRepository },
    { provide: 'PaymentRepositoryPort', useClass: PrismaPaymentRepository },
    { provide: 'WebhookEventRepositoryPort', useClass: PrismaWebhookEventRepository },
    { provide: 'WebhookRetryQueueRepositoryPort', useClass: PrismaWebhookRetryQueueRepository },
    { provide: 'ReconciliationCheckpointRepositoryPort', useClass: PrismaReconciliationCheckpointRepository },
    { provide: 'AnalysisReportRepositoryPort', useClass: PrismaAnalysisReportRepository },
    // USER-SOFT-DELETE sprint (2026-05-15): GDPR 익명화 영역 — basic 옵션 A 영역 (사용자 5/15 채택)
    { provide: 'UserAnonymizerPort', useClass: DefaultUserAnonymizerAdapter },
    // EMAIL-POLAR-READY Phase B (2026-05-27) — Email 어댑터 factory provider.
    // env EMAIL_PROVIDER 분기 (null/resend/sendgrid), 사용자 라이브 액션 1줄로 활성.
    { provide: 'EmailServicePort', useFactory: () => createEmailService() },
    // EMAIL-POLAR-READY Phase C (2026-05-27) — 이메일 인증 토큰 repository.
    { provide: 'EmailVerificationTokenRepositoryPort', useClass: PrismaEmailVerificationTokenRepository },
  ],
})
export class AppModule {
  /**
   * USER-SOFT-DELETE sprint (2026-05-15) — Author soft delete 적용 영역.
   *
   * Prisma 6.x 정합 (revision 159 ActivationFailed hotfix):
   * - Prisma 5.x `$use` 는 6.x 에서 제거됨 → AppModule constructor 에서 `$use` 호출 시
   *   `TypeError: prisma.$use is not a function` 으로 컨테이너 부팅 실패(ActivationFailed).
   * - soft delete 적용 책임을 `PrismaService.onModuleInit` (Client Extensions `$extends`)
   *   으로 이관 — AppModule constructor 의 직접 호출은 제거한다.
   * 정본: .claude/state/sprint-user-soft-delete-draft.md §10-1, ADR (Prisma 6.x 마이그레이션)
   */
}
