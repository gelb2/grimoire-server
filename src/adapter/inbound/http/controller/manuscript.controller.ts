import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { ParseManuscriptUseCase } from '@application/manuscript/parse-manuscript.usecase'
import { ParseManuscriptDto } from '../dto/manuscript.dto'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

@Controller('manuscripts')
@UseGuards(JwtAuthGuard)
export class ManuscriptController {
  constructor(private readonly parseManuscript: ParseManuscriptUseCase) {}

  @Post('parse')
  parse(@Body() dto: ParseManuscriptDto) {
    return this.parseManuscript.execute(dto.mdText)
  }
}
