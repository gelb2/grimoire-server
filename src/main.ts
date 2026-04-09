// [2026-04-08 Remote Test] 이 주석은 클로드 리모트 기능 세팅 및 아이패드 업무지시 가능성 확인 목적으로 작성됨. 업무와 무관한 테스트.
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import * as cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { validateEnv } from '@infrastructure/config/env.validation'

async function bootstrap() {
  validateEnv()

  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  })

  // HTTP 헤더 보안 (X-Frame-Options, HSTS, CSP 등)
  app.use(helmet())

  // Polar 웹훅은 raw body가 필요 (HMAC 서명 검증용)
  // setGlobalPrefix('api') 적용 전이므로 전체 경로로 지정
  app.use('/api/payments/webhook', require('express').raw({ type: '*/*', limit: '1mb' }))

  // JSON body 크기 제한 확대 (장편소설 원고 업로드 대응)
  app.use(require('express').json({ limit: '2mb' }))
  app.use(require('express').urlencoded({ extended: true, limit: '2mb' }))

  app.use(cookieParser())
  app.setGlobalPrefix('api')

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  // CORS: 원격 환경에서는 validateEnv()에서 이미 검증됨. localhost만 폴백.
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
    credentials: true,
  })

  const port = process.env.PORT || 3000
  await app.listen(port)
  console.log(`grimoire-server 시작 — 포트: ${port}`)

  // 그레이스풀 셧다운
  const shutdown = async (signal: string) => {
    console.log(`${signal} 수신 — 그레이스풀 셧다운 시작...`)
    await app.close()
    console.log('서버 정상 종료 완료')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

bootstrap()
