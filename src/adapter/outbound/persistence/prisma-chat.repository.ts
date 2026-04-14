import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { ChatRepositoryPort, ChatSession, ChatMessage } from '@domain/port/outbound/chat-repository.port'

@Injectable()
export class PrismaChatRepository implements ChatRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(authorId: string, workId: string, title?: string): Promise<ChatSession> {
    const row = await this.prisma.chatSession.create({
      data: { authorId, workId, title: title ?? '새 대화' },
    })
    return toSession(row)
  }

  async findSessionsByAuthorAndWork(authorId: string, workId: string): Promise<ChatSession[]> {
    const rows = await this.prisma.chatSession.findMany({
      where: { authorId, workId },
      orderBy: { updatedAt: 'desc' },
    })
    return rows.map(toSession)
  }

  async findSessionById(id: string): Promise<ChatSession | null> {
    const row = await this.prisma.chatSession.findUnique({ where: { id } })
    return row ? toSession(row) : null
  }

  async deleteSession(id: string): Promise<void> {
    await this.prisma.chatSession.delete({ where: { id } })
  }

  async updateSessionTitle(id: string, title: string): Promise<ChatSession> {
    const row = await this.prisma.chatSession.update({ where: { id }, data: { title } })
    return toSession(row)
  }

  async addMessage(sessionId: string, role: 'user' | 'assistant', content: string): Promise<ChatMessage> {
    const row = await this.prisma.chatMessage.create({
      data: { sessionId, role, content },
    })
    // 세션 updatedAt 갱신
    await this.prisma.chatSession.update({ where: { id: sessionId }, data: {} })
    return toMessage(row)
  }

  /** 커서 기반 페이지네이션: cursor ID 이전의 메시지를 limit개 반환 (시간순) */
  async getMessages(sessionId: string, limit: number, cursor?: string): Promise<ChatMessage[]> {
    const where: any = { sessionId }
    if (cursor) {
      const cursorMsg = await this.prisma.chatMessage.findUnique({ where: { id: cursor }, select: { createdAt: true } })
      if (cursorMsg) {
        where.createdAt = { lt: cursorMsg.createdAt }
      }
    }
    const rows = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    // 역순으로 반환 (오래된 순)
    return rows.reverse().map(toMessage)
  }

  async getRecentMessages(sessionId: string, limit: number): Promise<ChatMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return rows.reverse().map(toMessage)
  }
  async findActiveSessionsSince(since: Date): Promise<{ id: string; workId: string }[]> {
    return this.prisma.chatSession.findMany({
      where: { updatedAt: { gte: since } },
      select: { id: true, workId: true },
    })
  }

  async findSessionIdsByWorkId(workId: string): Promise<string[]> {
    const rows = await this.prisma.chatSession.findMany({
      where: { workId },
      select: { id: true },
    })
    return rows.map(r => r.id)
  }
}

function toSession(row: any): ChatSession {
  return { id: row.id, authorId: row.authorId, workId: row.workId, title: row.title, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function toMessage(row: any): ChatMessage {
  return { id: row.id, sessionId: row.sessionId, role: row.role, content: row.content, createdAt: row.createdAt }
}
