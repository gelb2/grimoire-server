import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { Response } from 'express'
import { isProduction } from '@infrastructure/config/app-env'

/** prod 환경에서 500 에러의 스택 트레이스/내부 메시지 노출 방지 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter')

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    if (exception instanceof HttpException) {
      // NestJS HttpException — 그대로 반환 (클라이언트용 메시지)
      const status = exception.getStatus()
      const body = exception.getResponse()
      response.status(status).json(body)
      return
    }

    // 예상치 못한 에러 — production(실서비스)에서만 내부 정보 숨김.
    // inhouse/dev는 QA 디버깅 편의를 위해 스택 노출 허용.
    const isProd = isProduction()
    const message = exception instanceof Error ? exception.message : String(exception)
    const stack = exception instanceof Error ? exception.stack : undefined

    this.logger.error(`Unhandled exception: ${message}`, stack)

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: isProd ? '서버 내부 오류가 발생했습니다' : message,
      ...(isProd ? {} : { error: 'Internal Server Error', stack }),
    })
  }
}
