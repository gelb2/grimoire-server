import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { SocialRepositoryPort } from '@domain/port/outbound/social-repository.port'
import { AuthorSpace, AuthorPublicProfile, WorkSummary, toSafeAuthor } from '@domain/model/author'

@Injectable()
export class AuthorUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('ThemeRepositoryPort') private readonly themeRepo: ThemeRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('SocialRepositoryPort') private readonly socialRepo: SocialRepositoryPort,
  ) {}

  async getAuthorSpace(slug: string): Promise<AuthorSpace> {
    const author = await this.authorRepo.findBySlug(slug)
    if (!author) {
      throw new NotFoundException('작가를 찾을 수 없습니다')
    }

    const themes = await this.themeRepo.findAllByAuthorId(author.id)
    const theme = themes[0] ?? null
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
          episodes: episodes.map((ep) => ({
            slug: ep.slug,
            title: ep.title,
            subtitle: ep.subtitle ?? null,
            description: ep.description ?? null,
            type: ep.type ?? 'episode',
            orderNum: ep.orderNum ?? null,
          })),
        }
      }),
    )

    return { author: toSafeAuthor(author), theme, works: workSummaries }
  }

  /** 작가 공개 프로필 조회 — 작가 정보 + 작품 목록 + 통계 */
  async getPublicProfile(slug: string): Promise<AuthorPublicProfile> {
    const author = await this.authorRepo.findBySlug(slug)
    if (!author) {
      throw new NotFoundException('작가를 찾을 수 없습니다')
    }

    const works = await this.workRepo.findByAuthorSlug(slug)

    const worksWithStats = await Promise.all(
      works.map(async (w) => {
        const episodes = await this.workRepo.findEpisodes(w.id)
        return {
          id: w.id,
          slug: w.slug,
          title: w.title,
          subtitle: w.subtitle,
          description: w.description,
          episodeCount: episodes.length,
          episodes: episodes.map((ep) => ({
            slug: ep.slug,
            title: ep.title,
            subtitle: ep.subtitle ?? null,
            description: ep.description ?? null,
            type: ep.type ?? 'episode',
            orderNum: ep.orderNum ?? null,
          })),
          viewCount: w.viewCount,
        }
      }),
    )

    const [subscriberCount, totalLikes] = await Promise.all([
      this.socialRepo.getSubscriberCount(author.id),
      this.socialRepo.getTotalLikesForAuthor(author.id),
    ])

    return {
      author: toSafeAuthor(author),
      works: worksWithStats,
      subscriberCount,
      totalLikes,
    }
  }

  /** 작가 프로필(name, bio) 업데이트 — 본인만 가능 */
  async updateProfile(slug: string, authorId: string, data: { name?: string; bio?: string }): Promise<{ name: string; bio: string }> {
    const author = await this.authorRepo.findBySlug(slug)
    if (!author) {
      throw new NotFoundException('작가를 찾을 수 없습니다')
    }
    if (author.id !== authorId) {
      throw new ForbiddenException('본인의 프로필만 수정할 수 있습니다')
    }
    if (data.name !== undefined && (data.name.trim().length === 0 || data.name.length > 50)) {
      throw new BadRequestException('작가명은 1~50자로 입력해주세요')
    }
    if (data.bio !== undefined && data.bio.length > 500) {
      throw new BadRequestException('소개글은 500자 이내로 작성해주세요')
    }
    const updated = await this.authorRepo.updateProfile(author.id, data)
    return { name: updated.name, bio: updated.bio ?? '' }
  }
}
