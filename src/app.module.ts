import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'

// 인프라
import { PrismaService } from '@infrastructure/prisma/prisma.service'

// 유스케이스
import { GenerateThemeUseCase } from '@application/theme/generate-theme.usecase'
import { GetThemeUseCase } from '@application/theme/get-theme.usecase'
import { ParseManuscriptUseCase } from '@application/manuscript/parse-manuscript.usecase'
import { CreditUseCase } from '@application/credit/credit.usecase'
import { AuthorUseCase } from '@application/author/author.usecase'
import { ContentUseCase } from '@application/content/content.usecase'
import { AuthUseCase } from '@application/auth/auth.usecase'

// 컨트롤러
import { HealthController } from '@adapter/inbound/http/controller/health.controller'
import { ThemeController } from '@adapter/inbound/http/controller/theme.controller'
import { ManuscriptController } from '@adapter/inbound/http/controller/manuscript.controller'
import { AuthorController } from '@adapter/inbound/http/controller/author.controller'
import { ContentController } from '@adapter/inbound/http/controller/content.controller'
import { AuthController } from '@adapter/inbound/http/controller/auth.controller'

// 아웃바운드 어댑터
import { PrismaAuthorRepository } from '@adapter/outbound/persistence/prisma-author.repository'
import { PrismaThemeRepository } from '@adapter/outbound/persistence/prisma-theme.repository'
import { PrismaWorkRepository } from '@adapter/outbound/persistence/prisma-work.repository'
import { PrismaCreditRepository } from '@adapter/outbound/persistence/prisma-credit.repository'
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
  ],
  providers: [
    // 인프라
    PrismaService,

    // 유스케이스
    GenerateThemeUseCase,
    GetThemeUseCase,
    ParseManuscriptUseCase,
    CreditUseCase,
    AuthorUseCase,
    ContentUseCase,
    AuthUseCase,
    JwtAuthGuard,

    // 포트 → 어댑터 바인딩 (토큰 기반 DI)
    { provide: 'AuthorRepositoryPort', useClass: PrismaAuthorRepository },
    { provide: 'ThemeRepositoryPort', useClass: PrismaThemeRepository },
    { provide: 'WorkRepositoryPort', useClass: PrismaWorkRepository },
    { provide: 'CreditRepositoryPort', useClass: PrismaCreditRepository },
    { provide: 'ClaudeApiPort', useClass: ClaudeThemeAdapter },
  ],
})
export class AppModule {}
