import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'

// 인프라
import { PrismaService } from '@infrastructure/prisma/prisma.service'

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
import { ReaderUseCase } from '@application/reader/reader.usecase'
import { DiscoveryUseCase } from '@application/discovery/discovery.usecase'
import { AdminUseCase } from '@application/admin/admin.usecase'
import { NovelAnalysisUseCase } from '@application/analysis/novel-analysis.usecase'

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

// 아웃바운드 어댑터
import { PrismaAuthorRepository } from '@adapter/outbound/persistence/prisma-author.repository'
import { PrismaThemeRepository } from '@adapter/outbound/persistence/prisma-theme.repository'
import { PrismaWorkRepository } from '@adapter/outbound/persistence/prisma-work.repository'
import { PrismaCreditRepository } from '@adapter/outbound/persistence/prisma-credit.repository'
import { PrismaReaderRepository } from '@adapter/outbound/persistence/prisma-reader.repository'
import { ClaudeThemeAdapter } from '@adapter/outbound/ai/claude-theme.adapter'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'grimoire-dev-secret',
      signOptions: { expiresIn: '7d' },
    }),
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
  ],
  providers: [
    // 인프라
    PrismaService,

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
    ReaderUseCase,
    DiscoveryUseCase,
    AdminUseCase,
    NovelAnalysisUseCase,
    JwtAuthGuard,

    // 포트 → 어댑터 바인딩 (토큰 기반 DI)
    { provide: 'AuthorRepositoryPort', useClass: PrismaAuthorRepository },
    { provide: 'ThemeRepositoryPort', useClass: PrismaThemeRepository },
    { provide: 'WorkRepositoryPort', useClass: PrismaWorkRepository },
    { provide: 'CreditRepositoryPort', useClass: PrismaCreditRepository },
    { provide: 'ReaderRepositoryPort', useClass: PrismaReaderRepository },
    { provide: 'ClaudeApiPort', useClass: ClaudeThemeAdapter },
  ],
})
export class AppModule {}
