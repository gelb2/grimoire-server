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

  // CORS: 환경변수 필수. 미설정 시 localhost 폴백 (prod에서 실수 방지)
  const corsOrigin = process.env.CORS_ORIGIN
  if (!corsOrigin && process.env.NODE_ENV === 'production') {
    console.error('FATAL: CORS_ORIGIN 환경변수가 설정되지 않았습니다.')
    process.exit(1)
  }
  app.enableCors({
    origin: corsOrigin || 'http://localhost:3001',
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
