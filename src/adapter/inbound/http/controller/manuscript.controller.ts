import { Controller, Post, Body } from '@nestjs/common'
import { ParseManuscriptUseCase } from '@application/manuscript/parse-manuscript.usecase'
import { ParseManuscriptDto } from '../dto/manuscript.dto'

@Controller('manuscripts')
export class ManuscriptController {
  constructor(private readonly parseManuscript: ParseManuscriptUseCase) {}

  @Post('parse')
  parse(@Body() dto: ParseManuscriptDto) {
    return this.parseManuscript.execute(dto.mdText)
  }
}
