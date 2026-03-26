import { Controller, Get, Param } from '@nestjs/common'
import { AuthorUseCase } from '@application/author/author.usecase'

@Controller('authors')
export class AuthorController {
  constructor(private readonly authorUseCase: AuthorUseCase) {}

  @Get(':slug')
  async getAuthorSpace(@Param('slug') slug: string) {
    return this.authorUseCase.getAuthorSpace(slug)
  }
}
