/**
 * 크레딧 개편 I Phase (2026-05-17) — SystemSetting key-value 조회 포트.
 *
 * 정본: .claude/state/sprint-credit-overhaul-s-phase-draft.md §4 게이트 5(b)
 *
 * 채팅 4구간 경계값/차감 N + deficit 상한을 SystemSetting 동적 값으로 로드
 * (운영 1~2주 실측 후 재배포 없이 재확정 — §8-4).
 *
 * 헥사고날 — domain 레이어. Prisma import 0건.
 */

import { SettingEntry } from '@domain/model/credit-system-setting'

export interface SystemSettingRepositoryPort {
  /** key prefix 로 SystemSetting row 조회 (예: 'chat.' / 'credit.') */
  findByPrefix(prefix: string): Promise<SettingEntry[]>
}
