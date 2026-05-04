import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'

// 인프라
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { BlobStorageService } from '@infrastructure/storage/blob-storage.service'
import { SemanticCacheService } from '@lib/semantic-cache'

// 유스케이스
import { GenerateThemeUseCase } from '@application/theme/generate-theme.usecase'
import { GetThemeUseCase } from '@application/theme/get-theme.usecase'
import { BakeThemeUseCase } from '@application/theme/bake-theme.usecase'
import { ParseManuscriptUseCase } from '@application/manuscript/parse-manuscript.usecase'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { AuthorUseCase } from '@application/author/author.usecase'
import { ContentUseCase } from '@application/content/content.usecase'
import { AuthUseCase } from '@application/auth/auth.usecase'
import { WorkManagementUseCase } from '@application/work/work-management.usecase'
import { PaymentUseCase } from '@application/payment/payment.usecase'
import { PaymentReconciliationJob } from '@application/payment/payment-reconciliation.job'
import { PaymentCleanupJob } from '@application/payment/payment-cleanup.job'
import { RefundPaymentUseCase } from '@application/payment/refund-payment.usecase'
import { ReaderUseCase } from '@application/reader/reader.usecase'
import { DiscoveryUseCase } from '@application/discovery/discovery.usecase'
import { AdminUseCase } from '@application/admin/admin.usecase'
import { AuditLogService } from '@application/admin/audit-log.service'
import { AccessLogService } from '@infrastructure/security/access-log.service'
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

// 아웃바운드 어댑터
import { PrismaAuthorRepository } from '@adapter/outbound/persistence/prisma-author.repository'
import { PrismaThemeRepository } from '@adapter/outbound/persistence/prisma-theme.repository'
import { PrismaWorkRepository } from '@adapter/outbound/persistence/prisma-work.repository'
import { PrismaCreditRepository } from '@adapter/outbound/persistence/prisma-credit.repository'
import { PrismaReaderRepository } from '@adapter/outbound/persistence/prisma-reader.repository'
import { PrismaSocialRepository } from '@adapter/outbound/persistence/prisma-social.repository'
import { PrismaStatsRepository } from '@adapter/outbound/persistence/prisma-stats.repository'
import { PrismaChatRepository } from '@adapter/outbound/persistence/prisma-chat.repository'
import { PrismaAuditLogRepository } from '@adapter/outbound/persistence/prisma-audit-log.repository'
import { PrismaAuthTokenRepository } from '@adapter/outbound/persistence/prisma-auth-token.repository'
import { PrismaSignupHistoryRepository } from '@adapter/outbound/persistence/prisma-signup-history.repository'
import { PrismaAdminRepository } from '@adapter/outbound/persistence/prisma-admin.repository'
import { PrismaPaymentRepository } from '@adapter/outbound/persistence/prisma-payment.repository'
import { PrismaWebhookEventRepository } from '@adapter/outbound/persistence/prisma-webhook-event.repository'
import { PrismaReconciliationCheckpointRepository } from '@adapter/outbound/persistence/prisma-reconciliation-checkpoint.repository'
import { PrismaAnalysisReportRepository } from '@adapter/outbound/persistence/prisma-analysis-report.repository'
import { ClaudeThemeAdapter } from '@adapter/outbound/ai/claude-theme.adapter'
import { OpenAIEmbeddingAdapter } from '@adapter/outbound/embedding/openai-embedding.adapter'
import { PgVectorAdapter } from '@adapter/outbound/vector/pgvector.adapter'
import { PolarAdapter } from '@adapter/outbound/payment/polar.adapter'
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
  ],
  providers: [
    // 인프라
    PrismaService,
    BlobStorageService,
    SemanticCacheService,

    // 유스케이스
    GenerateThemeUseCase,
    GetThemeUseCase,
    BakeThemeUseCase,
    ParseManuscriptUseCase,
    CreditUseCase,
    AuthorUseCase,
    ContentUseCase,
    AuthUseCase,
    WorkManagementUseCase,
    PaymentUseCase,
    PaymentReconciliationJob,
    PaymentCleanupJob,
    RefundPaymentUseCase,
    ReaderUseCase,
    DiscoveryUseCase,
    AdminUseCase,
    AuditLogService,
    AccessLogService,
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
    { provide: 'CreditRepositoryPort', useClass: PrismaCreditRepository },
    { provide: 'ReaderRepositoryPort', useClass: PrismaReaderRepository },
    { provide: 'ClaudeApiPort', useClass: ClaudeThemeAdapter },
    { provide: 'SocialRepositoryPort', useClass: PrismaSocialRepository },
    { provide: 'StatsRepositoryPort', useClass: PrismaStatsRepository },
    { provide: 'EmbeddingPort', useClass: OpenAIEmbeddingAdapter },
    { provide: 'VectorStorePort', useClass: PgVectorAdapter },
    { provide: 'PaymentGatewayPort', useClass: PolarAdapter },
    { provide: 'ChatRepositoryPort', useClass: PrismaChatRepository },
    { provide: 'BlobStoragePort', useClass: BlobStorageService },
    { provide: 'AuditLogRepositoryPort', useClass: PrismaAuditLogRepository },
    { provide: 'AuthTokenRepositoryPort', useClass: PrismaAuthTokenRepository },
    { provide: 'SignupHistoryRepositoryPort', useClass: PrismaSignupHistoryRepository },
    { provide: 'AdminRepositoryPort', useClass: PrismaAdminRepository },
    { provide: 'PaymentRepositoryPort', useClass: PrismaPaymentRepository },
    { provide: 'WebhookEventRepositoryPort', useClass: PrismaWebhookEventRepository },
    { provide: 'ReconciliationCheckpointRepositoryPort', useClass: PrismaReconciliationCheckpointRepository },
    { provide: 'AnalysisReportRepositoryPort', useClass: PrismaAnalysisReportRepository },
  ],
})
export class AppModule {}
