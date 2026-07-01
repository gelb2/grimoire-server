import { AuthenticatedRequest } from '@adapter/inbound/http/dto/authenticated-request'
import * as path from 'path'
import {
  Controller, Get, Post, Patch, Delete, Put, Body, Param,
  UseGuards, UseInterceptors, UploadedFile, Req, BadRequestException,
  Inject,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { WorkManagementUseCase } from '@application/work/work-management.usecase'
import { BlobStoragePort } from '@domain/port/outbound/blob-storage.port'
import { CreateWorkDto, UpdateWorkDto, CreateEpisodeDto, UpdateEpisodeStatusDto, CreateShareLinkDto } from '@adapter/inbound/http/dto/work.dto'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']
const MAX_IMAGE_SIZE = 5 * 1024 * 1024  // 5MB

@Controller('works')
@UseGuards(JwtAuthGuard)
export class WorkManagementController {
  constructor(
    private readonly workManagementUseCase: WorkManagementUseCase,
    @Inject('BlobStoragePort') private readonly blobStorage: BlobStoragePort,
  ) {}

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Post()
  async createWork(@Req() req: AuthenticatedRequest, @Body() dto: CreateWorkDto) {
    return this.workManagementUseCase.createWork(req.user.sub, dto)
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Patch(':id')
  async updateWork(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateWorkDto) {
    return this.workManagementUseCase.updateWork(req.user.sub, id, dto)
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })  // 분당 5회
  @Delete(':id')
  async deleteWork(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.workManagementUseCase.deleteWork(req.user.sub, id)
    return { deleted: true }
  }

  @Throttle({ default: { ttl: 60000, limit: 20 } })  // 분당 20회
  @Post(':workId/episodes')
  async createEpisode(@Req() req: AuthenticatedRequest, @Param('workId') workId: string, @Body() dto: CreateEpisodeDto) {
    return this.workManagementUseCase.createEpisode(req.user.sub, workId, dto)
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })  // 분당 5회 (이미지 업로드 엄격 제한)
  @Put(':id/cover')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_SIZE },
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase()
        if (ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
          cb(null, true)
        } else {
          cb(new BadRequestException(`이미지 파일만 허용됩니다: ${ALLOWED_IMAGE_EXTENSIONS.join(', ')}`), false)
        }
      },
    }),
  )
  async uploadCover(@Req() req: AuthenticatedRequest, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('이미지 파일이 첨부되지 않았습니다')
    if (!this.blobStorage.isEnabled()) throw new BadRequestException('커버 이미지 기능이 아직 활성화되지 않았습니다')

    return this.workManagementUseCase.uploadCoverImage(req.user.sub, id, file.buffer, file.originalname, file.mimetype)
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Patch(':workId/episodes/:episodeId/status')
  async updateEpisodeStatus(
    @Req() req: AuthenticatedRequest,
    @Param('episodeId') episodeId: string,
    @Body() dto: UpdateEpisodeStatusDto,
  ) {
    return this.workManagementUseCase.updateEpisodeStatus(req.user.sub, episodeId, dto.status)
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post(':workId/episodes/:episodeId/share')
  async createShareLink(
    @Req() req: AuthenticatedRequest,
    @Param('episodeId') episodeId: string,
    @Body() dto: CreateShareLinkDto,
  ) {
    return this.workManagementUseCase.createShareLink(req.user.sub, episodeId, dto.expireIn)
  }
}

@Controller('episodes')
@UseGuards(JwtAuthGuard)
export class EpisodeManagementController {
  constructor(private readonly workManagementUseCase: WorkManagementUseCase) {}

  /** 작가 본인 에피소드 rawMd 조회 (인라인 본문 편집용, 묶음 MM 신설) */
  @Throttle({ default: { ttl: 60000, limit: 30 } })  // 분당 30회
  @Get(':episodeId/raw')
  async getEpisodeRaw(
    @Req() req: AuthenticatedRequest,
    @Param('episodeId') episodeId: string,
  ) {
    return this.workManagementUseCase.getEpisodeRawForOwner(req.user.sub, episodeId)
  }

  /** 에피소드 재업로드 (파일 교체) */
  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 분당 10회
  @Patch(':episodeId/reupload')
  async reuploadEpisode(
    @Req() req: AuthenticatedRequest,
    @Param('episodeId') episodeId: string,
    @Body() body: { title?: string; rawContent: string; sourceFormat?: string },
  ) {
    return this.workManagementUseCase.reuploadEpisode(req.user.sub, episodeId, body)
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })  // 분당 5회
  @Delete(':id')
  async deleteEpisode(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.workManagementUseCase.deleteEpisode(req.user.sub, id)
    return { deleted: true }
  }
}
