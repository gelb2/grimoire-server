import { Injectable, Inject, NotFoundException } from '@nestjs/common'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { AuthorSpace, WorkSummary, toSafeAuthor } from '@domain/model/author'

@Injectable()
export class AuthorUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('ThemeRepositoryPort') private readonly themeRepo: ThemeRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
  ) {}

  async getAuthorSpace(slug: string): Promise<AuthorSpace> {
    const author = await this.authorRepo.findBySlug(slug)
    if (!author) {
      throw new NotFoundException('작가를 찾을 수 없습니다')
    }

    const theme = await this.themeRepo.findByAuthorId(author.id)
    const works = await this.workRepo.findByAuthorSlug(slug)

    const workSummaries: WorkSummary[] = await Promise.all(
      works.map(async (w) => {
        const episodes = await this.workRepo.findEpisodes(w.id)
        return {
          id: w.id,
          slug: w.slug,
          title: w.title,
          subtitle: w.subtitle,
          description: w.description,
          episodeCount: episodes.length,
        }
      }),
    )

    return { author: toSafeAuthor(author), theme, works: workSummaries }
  }
}
