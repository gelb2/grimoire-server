import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import {
  WebhookRetryQueueRecord,
  WebhookRetryQueueRepositoryPort,
  WebhookRetryQueueUpsertInput,
} from '@domain/port/outbound/webhook-retry-queue-repository.port'

/**
 * Prisma 기반 WebhookRetryQueue 리포지토리 (PAY-P2-2 — Postgres DLQ).
 *
 * 핵심:
 * - upsert는 P2002 (unique 제약 위반) 시 null 반환 — 동시 진입 race 안전.
 *   기존 row의 retryCount는 markRetry로만 증가 (createdAt 보존).
 * - findDue는 nextRetryAt <= now ORDER BY nextRetryAt ASC LIMIT N.
 * - markRetry는 retryCount 증가 + lastError(앞 500자) + nextRetryAt 갱신.
 *
 * Sprint: PAY-P2-2 (2026-05-05)
 * 정본: `.claude/shared-contracts.md` §18 WebhookDLQ
 */
@Injectable()
export class PrismaWebhookRetryQueueRepository implements WebhookRetryQueueRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: WebhookRetryQueueUpsertInput): Promise<WebhookRetryQueueRecord | null> {
    try {
      const row = await this.prisma.webhookRetryQueue.create({
        data: {
          eventId: input.eventId,
          payload: input.payload as Prisma.InputJsonValue,
          retryCount: 0,
          lastError: null,
          nextRetryAt: input.nextRetryAt,
        },
      })
      return this.toDomain(row)
    } catch (e: unknown) {
      // P2002: 같은 eventId 박제됨 — 기존 row 보존, race 안전 null 반환.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return null
      }
      throw e
    }
  }

  async findDue(now: Date, limit = 100): Promise<WebhookRetryQueueRecord[]> {
    const rows = await this.prisma.webhookRetryQueue.findMany({
      where: { nextRetryAt: { lte: now } },
      orderBy: { nextRetryAt: 'asc' },
      take: limit,
    })
    return rows.map((row) => this.toDomain(row))
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.webhookRetryQueue.delete({ where: { id } })
  }

  async markRetry(id: string, error: string, nextRetryAt: Date): Promise<void> {
    const truncated = error.length > 500 ? error.slice(0, 500) : error
    await this.prisma.webhookRetryQueue.update({
      where: { id },
      data: {
        retryCount: { increment: 1 },
        lastError: truncated,
        nextRetryAt,
      },
    })
  }

  async findByEventId(eventId: string): Promise<WebhookRetryQueueRecord | null> {
    const row = await this.prisma.webhookRetryQueue.findUnique({ where: { eventId } })
    if (!row) return null
    return this.toDomain(row)
  }

  private toDomain(row: {
    id: string
    eventId: string
    payload: unknown
    retryCount: number
    lastError: string | null
    nextRetryAt: Date
    createdAt: Date
  }): WebhookRetryQueueRecord {
    return {
      id: row.id,
      eventId: row.eventId,
      payload: row.payload,
      retryCount: row.retryCount,
      lastError: row.lastError,
      nextRetryAt: row.nextRetryAt,
      createdAt: row.createdAt,
    }
  }
}
