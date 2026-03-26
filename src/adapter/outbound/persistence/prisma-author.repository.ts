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

  async updateCredits(id: string, credits: number): Promise<Author> {
    const row = await this.prisma.author.update({
      where: { id },
      data: { credits },
    })
    return toDomain(row)
  }
}

function toDomain(row: { id: string; slug: string; name: string; email: string; passwordHash?: string | null; credits: number; createdAt: Date }): Author {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash ?? undefined,
    credits: row.credits,
    createdAt: row.createdAt,
  }
}
