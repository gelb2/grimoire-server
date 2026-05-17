import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'
import { SystemSettingRepositoryPort } from '@domain/port/outbound/system-setting-repository.port'
import { SettingEntry } from '@domain/model/credit-system-setting'

/**
 * 크레딧 개편 I Phase (2026-05-17) — SystemSetting key-value Prisma 어댑터.
 *
 * 정본: .claude/state/sprint-credit-overhaul-s-phase-draft.md §4 게이트 5(b)
 *
 * 채팅 4구간 경계값/차감 N + deficit 상한을 동적 로드 — row 가 없으면
 * 도메인 파서(loadChatChargeTiers/loadDeficitLimit)가 §8 기본값으로 폴백.
 */
@Injectable()
export class PrismaSystemSettingRepository
  implements SystemSettingRepositoryPort
{
  constructor(private readonly prisma: PrismaService) {}

  async findByPrefix(prefix: string): Promise<SettingEntry[]> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: prefix } },
    })
    return rows.map((r) => ({ key: r.key, value: r.value }))
  }
}
