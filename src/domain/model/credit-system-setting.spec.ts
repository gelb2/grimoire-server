import {
  loadChatChargeTiers,
  loadDeficitLimit,
  DEFAULT_DEFICIT_LIMIT,
  SETTING_KEY,
  SettingEntry,
} from './credit-system-setting'

/**
 * 크레딧 개편 I Phase — SystemSetting 동적 경계값/차감 N spec.
 * 정본: S Phase Draft §4 게이트 5(b), §9.
 */
describe('credit-system-setting — SystemSetting 동적 값', () => {
  describe('loadChatChargeTiers — 채팅 4구간 동적 로드', () => {
    it('SystemSetting 이 비어 있으면 §8 기본값으로 폴백 (4구간)', () => {
      const tiers = loadChatChargeTiers([])
      expect(tiers).toHaveLength(4)
      expect(tiers[0].points).toBe(190)
      expect(tiers[1].points).toBe(810)
      expect(tiers[2].points).toBe(3390)
      expect(tiers[3].points).toBe(5520)
    })

    it('기본값 폴백 시 경계도 §8 기본값 (500/4,000/12,000)', () => {
      const tiers = loadChatChargeTiers([])
      expect(tiers[0].inputMax).toBe(500)
      expect(tiers[1].inputMax).toBe(4000)
      expect(tiers[2].inputMax).toBe(12000)
    })

    it('SystemSetting 경계값을 동적 오버라이드한다 (운영 재확정 — §8-4)', () => {
      const settings: SettingEntry[] = [
        { key: SETTING_KEY.CHAT_TIER_BOUNDARY_SHORT, value: '600' },
      ]
      const tiers = loadChatChargeTiers(settings)
      expect(tiers[0].inputMax).toBe(600)
      // 오버라이드 안 한 항목은 기본값 유지
      expect(tiers[1].inputMax).toBe(4000)
    })

    it('SystemSetting 차감 N 을 동적 오버라이드한다', () => {
      const settings: SettingEntry[] = [
        { key: SETTING_KEY.CHAT_TIER_POINTS_NORMAL, value: '850' },
      ]
      const tiers = loadChatChargeTiers(settings)
      expect(tiers[1].points).toBe(850)
    })

    it('xlong 의 inputMax 는 오버라이드 불가 — 항상 Infinity', () => {
      const settings: SettingEntry[] = [
        { key: 'chat.tier.boundary.xlong', value: '99999' },
      ]
      const tiers = loadChatChargeTiers(settings)
      expect(tiers[3].inputMax).toBe(Number.POSITIVE_INFINITY)
    })

    it('잘못된 값(음수/NaN)은 무시하고 기본값 폴백 (운영 입력 방어)', () => {
      const settings: SettingEntry[] = [
        { key: SETTING_KEY.CHAT_TIER_POINTS_SHORT, value: '-100' },
        { key: SETTING_KEY.CHAT_TIER_POINTS_NORMAL, value: 'abc' },
      ]
      const tiers = loadChatChargeTiers(settings)
      expect(tiers[0].points).toBe(190)
      expect(tiers[1].points).toBe(810)
    })

    it('항상 4구간을 반환한다 (3구간 회귀 차단 — §8-8 #4)', () => {
      const tiers = loadChatChargeTiers([
        { key: SETTING_KEY.CHAT_TIER_POINTS_SHORT, value: '200' },
      ])
      expect(tiers.map((t) => t.tier)).toEqual([
        'short',
        'normal',
        'long',
        'xlong',
      ])
    })
  })

  describe('loadDeficitLimit — 외상 상한 동적 로드', () => {
    it('SystemSetting 이 없으면 기본값 10,000 (게이트 5(c))', () => {
      expect(loadDeficitLimit([])).toBe(DEFAULT_DEFICIT_LIMIT)
      expect(DEFAULT_DEFICIT_LIMIT).toBe(10000)
    })

    it('SystemSetting 외상 상한을 동적 오버라이드한다', () => {
      const settings: SettingEntry[] = [
        { key: SETTING_KEY.DEFICIT_LIMIT, value: '20000' },
      ]
      expect(loadDeficitLimit(settings)).toBe(20000)
    })

    it('잘못된 외상 상한값은 기본값 폴백', () => {
      const settings: SettingEntry[] = [
        { key: SETTING_KEY.DEFICIT_LIMIT, value: '-5' },
      ]
      expect(loadDeficitLimit(settings)).toBe(DEFAULT_DEFICIT_LIMIT)
    })
  })
})
