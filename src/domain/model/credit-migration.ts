/**
 * 크레딧 개편 I Phase (2026-05-17) — 디노미네이션 마이그레이션 정합 검증 헬퍼.
 *
 * 정본: .claude/state/sprint-credit-overhaul-s-phase-draft.md §7 단계4 + 마이그레이션 정합성 검증
 *
 * migration.sql §B 데이터 마이그레이션의 정합 규칙을 순수 함수로 박제 — I Phase spec 검증 +
 * dev/prod 마이그레이션 단계6/9 직후 검증 기준의 코드 정본.
 *
 * 헥사고날상 domain 순수 영역 — Prisma/NestJS import 0건.
 */

import { CREDIT_TO_POINT, creditsToPoints } from '@domain/model/credit-point'
import { MembershipTier, monthlyPoolFor, normalizeMembershipTier } from '@domain/model/membership-tier'

/** 마이그레이션 전 작가 1명의 스냅샷 */
export interface PreMigrationAuthor {
  id: string
  /** 마이그레이션 전 정수 크레딧 잔액 */
  credits: number
  /** 마이그레이션 전 plan 문자열 */
  plan: string
}

/** 마이그레이션 후 작가 1명의 기대값 */
export interface MigratedAuthorExpectation {
  id: string
  /** points_charged = credits × 1,000 (§8-6 전량 충전 분류) */
  pointsCharged: number
  /** points_subscription = 구독 등급 풀 크기 (pro/premium) */
  pointsSubscription: number
  /** CreditLedger 초기 charged earn row 가 생성되는지 (credits > 0 일 때만) */
  hasChargedLedgerRow: boolean
  /** CreditLedger 초기 subscription earn row 가 생성되는지 (pro/premium 일 때만) */
  hasSubscriptionLedgerRow: boolean
  /** MembershipPlan tier */
  membershipTier: MembershipTier
}

/**
 * 마이그레이션 전 작가 스냅샷 → 마이그레이션 후 기대값 계산.
 * migration.sql §B-(a)(b)(c)(c-2)(c-3) 의 정합 규칙을 코드로 박제.
 *
 * @param author 마이그레이션 전 작가 스냅샷
 * @returns 마이그레이션 후 기대값 (검증 기준)
 */
export function expectMigratedAuthor(
  author: PreMigrationAuthor,
): MigratedAuthorExpectation {
  const tier = normalizeMembershipTier(author.plan)
  const pool = monthlyPoolFor(tier)
  return {
    id: author.id,
    // §B-(a) — credits × 1,000 전량 충전 출처로
    pointsCharged: creditsToPoints(author.credits),
    // §B-(c-3) — 구독 작가 캐시 풀 동기
    pointsSubscription: pool,
    // §B-(b) — credits > 0 작가만 초기 charged ledger row
    hasChargedLedgerRow: author.credits > 0,
    // §B-(c-2) — pro/premium 만 초기 subscription ledger row
    hasSubscriptionLedgerRow: tier === 'pro' || tier === 'premium',
    membershipTier: tier,
  }
}

/**
 * 마이그레이션 정합성 검증 — 전체 작가 집합 기준 (단계6/9 직후 필수).
 *
 * §7 검증 기준:
 *   - SUM(points_charged) = SUM(credits) × 1,000
 *   - CreditLedger 초기 charged row 수 = credits > 0 작가 수
 *
 * @param authors 마이그레이션 전 작가 스냅샷 배열
 * @returns 검증 기준값 (실측과 대조 — 1pt도 어긋나면 롤백)
 */
export function migrationIntegrityCriteria(
  authors: readonly PreMigrationAuthor[],
): {
  expectedSumPointsCharged: number
  expectedChargedLedgerRowCount: number
} {
  let expectedSumPointsCharged = 0
  let expectedChargedLedgerRowCount = 0
  for (const a of authors) {
    expectedSumPointsCharged += creditsToPoints(a.credits)
    if (a.credits > 0) expectedChargedLedgerRowCount += 1
  }
  return { expectedSumPointsCharged, expectedChargedLedgerRowCount }
}

/** 디노미네이션 비율 상수 재노출 (마이그레이션 SQL 의 ×1000 정합 검증용) */
export const DENOMINATION_FACTOR = CREDIT_TO_POINT
