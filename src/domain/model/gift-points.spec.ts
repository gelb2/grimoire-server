/**
 * GIFT_POINT_OPTIONS 단위 검증 (CC-2b §6 — 메인 결정 정본).
 */
import { GIFT_POINT_OPTIONS, isGiftPointOption } from './gift-points'

describe('GIFT_POINT_OPTIONS — 응원 선물 단위 정본', () => {
  it('S Phase §8-6 잠정값 그대로 1,000·3,000·5,000pt 3단계로 박제된다', () => {
    expect(GIFT_POINT_OPTIONS).toEqual([1000, 3000, 5000])
  })

  it('isGiftPointOption 은 정본 3단계 값만 true 반환한다', () => {
    expect(isGiftPointOption(1000)).toBe(true)
    expect(isGiftPointOption(3000)).toBe(true)
    expect(isGiftPointOption(5000)).toBe(true)
  })

  it('isGiftPointOption 은 외 값에 false 반환한다 (크레딧 단위 1·3·5 포함)', () => {
    expect(isGiftPointOption(0)).toBe(false)
    expect(isGiftPointOption(1)).toBe(false)
    expect(isGiftPointOption(3)).toBe(false)
    expect(isGiftPointOption(5)).toBe(false)
    expect(isGiftPointOption(2000)).toBe(false)
    expect(isGiftPointOption(10000)).toBe(false)
  })
})
