import * as path from 'path'
import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { ParseManuscriptUseCase, ManuscriptFormat } from '@application/manuscript/parse-manuscript.usecase'
import { ParseManuscriptDto } from '../dto/manuscript.dto'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

/** 허용 확장자 목록 */
const ALLOWED_EXTENSIONS = ['.md', '.txt', '.docx', '.hwp', '.hwpx']

/** 최대 파일 크기: 10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024

@Controller('manuscripts')
@UseGuards(JwtAuthGuard)
export class ManuscriptController {
  constructor(private readonly parseManuscript: ParseManuscriptUseCase) {}

  @Throttle({ default: { ttl: 60000, limit: 20 } })  // 분당 20회
  @Post('parse')
  parse(@Body() dto: ParseManuscriptDto) {
    return this.parseManuscript.execute(dto.mdText)
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회 (파일 업로드는 더 제한)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase()
        if (ALLOWED_EXTENSIONS.includes(ext)) {
          cb(null, true)
        } else {
          cb(
            new BadRequestException(
              `지원하지 않는 파일 형식입니다: ${ext}. 허용: ${ALLOWED_EXTENSIONS.join(', ')}`,
            ),
            false,
          )
        }
      },
    }),
  )
  async uploadManuscript(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('파일이 첨부되지 않았습니다')
    }

    // 확장자에서 포맷 결정
    const ext = path.extname(file.originalname).toLowerCase().slice(1)
    const format = ext as ManuscriptFormat

    return this.parseManuscript.executeFromBuffer({
      buffer: file.buffer,
      format,
      filename: file.originalname,
    })
  }
}
