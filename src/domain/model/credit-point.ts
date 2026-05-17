/**
 * 크레딧 개편 I Phase (2026-05-17) — 디노미네이션 + Point 값 객체.
 *
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-1
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §5, §11 §30
 *
 * 디노미네이션 1크레딧 = 1,000pt, 단일 통화. 기존 Author.credits 잔액은 ×1,000 자동 환산.
 * 헥사고날상 domain 순수 영역 — Prisma/NestJS import 0건.
 */

/** 디노미네이션 상수 — 1 크레딧 = 1,000 pt (§8-1 확정, 재산정 금지) */
export const CREDIT_TO_POINT = 1000

/**
 * 정수 크레딧을 포인트로 환산.
 * 마이그레이션(credits×1000) + 레거시 호환 코드에서 사용.
 */
export function creditsToPoints(credits: number): number {
  return credits * CREDIT_TO_POINT
}

/**
 * 포인트를 크레딧 표시 단위로 환산 (표시용 — 소수점 발생 가능).
 * 회계 계산에는 사용 금지 — 포인트가 회계 정본.
 */
export function pointsToCredits(points: number): number {
  return points / CREDIT_TO_POINT
}

/**
 * Point 값 객체 — 음수 포인트를 도메인 레벨에서 차단.
 *
 * 잔액/적립액은 항상 0 이상이어야 한다 (외상은 Author.deficitPoints 로 별도 관리).
 * 차감액(부호 있는 ledger amount)에는 사용하지 않는다 — 잔액·적립 표현 전용.
 */
export class Point {
  private constructor(private readonly value: number) {}

  /**
   * Point 생성 — 음수 거부, 정수 강제.
   * @throws Error 음수 또는 비정수 입력
   */
  static of(value: number): Point {
    if (!Number.isFinite(value)) {
      throw new Error(`포인트는 유한한 숫자여야 합니다: ${value}`)
    }
    if (!Number.isInteger(value)) {
      throw new Error(`포인트는 정수여야 합니다: ${value}`)
    }
    if (value < 0) {
      throw new Error(`포인트는 음수일 수 없습니다: ${value}`)
    }
    return new Point(value)
  }

  /** 0 포인트 */
  static zero(): Point {
    return new Point(0)
  }

  /** 크레딧 정수에서 Point 생성 (×1,000 환산) */
  static fromCredits(credits: number): Point {
    return Point.of(creditsToPoints(credits))
  }

  /** 포인트 가산 */
  add(other: Point): Point {
    return new Point(this.value + other.value)
  }

  /**
   * 포인트 차감 — 잔액 부족 시 throw (음수 잔액 방지).
   * 잔액 부족을 허용하는 외상 차감에는 subtractAllowingDeficit 사용.
   */
  subtract(other: Point): Point {
    if (this.value < other.value) {
      throw new Error(`포인트 잔액 부족: ${this.value} < ${other.value}`)
    }
    return new Point(this.value - other.value)
  }

  /** 원시 숫자 값 */
  toNumber(): number {
    return this.value
  }

  /** 잔액이 충분한지 (>= amount) */
  isSufficientFor(amount: number): boolean {
    return this.value >= amount
  }
}
