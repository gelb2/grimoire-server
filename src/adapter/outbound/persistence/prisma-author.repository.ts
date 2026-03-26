import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { Author } from '@domain/model/author'

@Injectable()
export class PrismaAuthorRepository implements AuthorRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Author | null> {
    const row = await this.prisma.author.findUnique({ where: { id } })
    return row ? toDomain(row) : null
  }

  async findBySlug(slug: string): Promise<Author | null> {
    const row = await this.prisma.author.findUnique({ where: { slug } })
    return row ? toDomain(row) : null
  }

  async findByEmail(email: string): Promise<Author | null> {
    const row = await this.prisma.author.findUnique({ where: { email } })
    return row ? toDomain(row) : null
  }

  async create(input: { slug: string; name: string; email: string; passwordHash?: string }): Promise<Author> {
    const row = await this.prisma.author.create({ data: input })
    return toDomain(row)
  }

  async findBySocialAccount(provider: string, providerId: string): Promise<Author | null> {
    const social = await this.prisma.socialAccount.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { author: true },
    })
    return social ? toDomain(social.author) : null
  }

  async updateCredits(id: string, credits: number): Promise<Author> {
    const row = await this.prisma.author.update({
      where: { id },
      data: { credits },
    })
    return toDomain(row)
  }

  async linkSocialAccount(authorId: string, provider: string, providerId: string, email?: string): Promise<void> {
    await this.prisma.socialAccount.create({
      data: { authorId, provider, providerId, providerEmail: email },
    })
  }

  async search(query: string, limit: number): Promise<Author[]> {
    const rows = await this.prisma.author.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { slug: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toDomain)
  }
}

function toDomain(row: { id: string; slug: string; name: string; email: string; passwordHash?: string | null; role: string; credits: number; createdAt: Date }): Author {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash ?? undefined,
    role: row.role,
    credits: row.credits,
    createdAt: row.createdAt,
  }
}
