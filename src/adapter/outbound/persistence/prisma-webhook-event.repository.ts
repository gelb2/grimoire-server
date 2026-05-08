import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import {
  WebhookEventCreateInput,
  WebhookEventRecord,
  WebhookEventRepositoryPort,
  WebhookEventStatus,
} from '@domain/port/outbound/webhook-event-repository.port'

/**
 * Prisma 기반 WebhookEvent 리포지토리.
 *
 * 핵심: createIfAbsent는 P2002 (unique 제약 위반) 시 null 반환 — 동시 진입 race 안전.
 * Sprint: PAY-P0-1 (2026-05-03)
 */
@Injectable()
export class PrismaWebhookEventRepository implements WebhookEventRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByEventId(eventId: string): Promise<WebhookEventRecord | null> {
    const row = await this.prisma.webhookEvent.findUnique({ where: { eventId } })
    if (!row) return null
    return this.toDomain(row)
  }

  async createIfAbsent(input: WebhookEventCreateInput): Promise<WebhookEventRecord | null> {
    try {
      const row = await this.prisma.webhookEvent.create({
        data: {
          eventId: input.eventId,
          source: input.source,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonValue,
          status: input.status ?? 'processed',
          errorMessage: input.errorMessage ?? null,
        },
      })
      return this.toDomain(row)
    } catch (e: unknown) {
      // P2002: unique 제약 위반 — 다른 worker가 먼저 INSERT 완료. 안전하게 null 반환.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return null
      }
      throw e
    }
  }

  async markStatus(eventId: string, status: WebhookEventStatus, errorMessage?: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { eventId },
      data: {
        status,
        errorMessage: errorMessage ?? null,
      },
    })
  }

  private toDomain(row: {
    id: string
    eventId: string
    source: string
    eventType: string
    status: string
    processedAt: Date
  }): WebhookEventRecord {
    return {
      id: row.id,
      eventId: row.eventId,
      source: row.source,
      eventType: row.eventType,
      status: row.status as WebhookEventStatus,
      processedAt: row.processedAt,
    }
  }
}
