/**
 * 크레딧 개편 I Phase (2026-05-17) — SystemSetting 동적 값 키 + 파서.
 *
 * 정본: .claude/state/sprint-credit-overhaul-s-phase-draft.md §4 게이트 5(b), §6 #8
 *
 * §8-4 — 채팅 구간 경계값(500/4,000/12,000)은 가정값 → 운영 1~2주 실측 후 재확정.
 * 하드코딩이면 재확정 시 재배포 필수 → SystemSetting(key-value) 동적 값으로 분리.
 * 차감 N(190/810/3,390/5,520)도 동일 — 단 §0 직결값이라 cost-accountant 승인 게이트 연동.
 * deficit 상한(-10,000pt)도 SystemSetting (게이트 5(c)).
 *
 * 본 파일은 SystemSetting row 가 없으면 §8 기본값으로 폴백 — 마이그레이션 후 정상.
 * 헥사고날상 domain 순수 영역 — Prisma/NestJS import 0건.
 */

import {
  CHAT_CHARGE_TIERS,
  ChatChargeTierDef,
} from '@domain/model/chat-charge-tier'

/** SystemSetting key 상수 — 채팅 4구간 경계값 (input 토큰 상한) */
export const SETTING_KEY = {
  CHAT_TIER_BOUNDARY_SHORT: 'chat.tier.boundary.short',
  CHAT_TIER_BOUNDARY_NORMAL: 'chat.tier.boundary.normal',
  CHAT_TIER_BOUNDARY_LONG: 'chat.tier.boundary.long',
  CHAT_TIER_POINTS_SHORT: 'chat.tier.points.short',
  CHAT_TIER_POINTS_NORMAL: 'chat.tier.points.normal',
  CHAT_TIER_POINTS_LONG: 'chat.tier.points.long',
  CHAT_TIER_POINTS_XLONG: 'chat.tier.points.xlong',
  /** 외상 상한 (절대값) — deficitPoints 가 이 값 도달 시 신규 채팅 차단 */
  DEFICIT_LIMIT: 'credit.deficit.limit',
} as const

/**
 * 외상 상한 기본값 (절대값) — §4 게이트 5(c) 권장 -10,000pt.
 * deficitPoints (양수 저장) 가 이 값 이상이면 신규 채팅 차단 → 충전 유도.
 */
export const DEFAULT_DEFICIT_LIMIT = 10000

/** SystemSetting row (key-value) — 도메인 표현 */
export interface SettingEntry {
  key: string
  value: string
}

/**
 * SystemSetting 목록에서 채팅 4구간 정의를 조립.
 * 키가 없거나 파싱 불가면 §8 기본값(CHAT_CHARGE_TIERS) 으로 항목별 폴백.
 *
 * @param settings SystemSetting row 배열 (credit.* / chat.* 키)
 * @returns 채팅 4구간 정의 (항상 4개 — short/normal/long/xlong)
 */
export function loadChatChargeTiers(
  settings: readonly SettingEntry[],
): readonly ChatChargeTierDef[] {
  const map = new Map(settings.map((s) => [s.key, s.value]))

  const num = (key: string, fallback: number): number => {
    const raw = map.get(key)
    if (raw === undefined) return fallback
    const parsed = Number(raw)
    // 음수·NaN·0 은 무효 → 기본값 폴백 (잘못된 운영 입력 방어)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  const base = CHAT_CHARGE_TIERS
  return [
    {
      tier: 'short',
      inputMax: num(SETTING_KEY.CHAT_TIER_BOUNDARY_SHORT, base[0].inputMax),
      points: num(SETTING_KEY.CHAT_TIER_POINTS_SHORT, base[0].points),
    },
    {
      tier: 'normal',
      inputMax: num(SETTING_KEY.CHAT_TIER_BOUNDARY_NORMAL, base[1].inputMax),
      points: num(SETTING_KEY.CHAT_TIER_POINTS_NORMAL, base[1].points),
    },
    {
      tier: 'long',
      inputMax: num(SETTING_KEY.CHAT_TIER_BOUNDARY_LONG, base[2].inputMax),
      points: num(SETTING_KEY.CHAT_TIER_POINTS_LONG, base[2].points),
    },
    {
      // xlong 은 경계 없음 (Infinity 고정) — points 만 동적
      tier: 'xlong',
      inputMax: Number.POSITIVE_INFINITY,
      points: num(SETTING_KEY.CHAT_TIER_POINTS_XLONG, base[3].points),
    },
  ]
}

/**
 * SystemSetting 목록에서 외상 상한(절대값)을 로드.
 * 키가 없거나 파싱 불가면 DEFAULT_DEFICIT_LIMIT(10,000) 폴백.
 */
export function loadDeficitLimit(settings: readonly SettingEntry[]): number {
  const raw = settings.find((s) => s.key === SETTING_KEY.DEFICIT_LIMIT)?.value
  if (raw === undefined) return DEFAULT_DEFICIT_LIMIT
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DEFICIT_LIMIT
}
