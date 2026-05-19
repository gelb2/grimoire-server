/**
 * 크레딧 개편 I Phase (2026-05-17) — 포인트 소진 우선순위 + deficit(외상) 상계 정책.
 *
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-2, §8-4
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §4 게이트 1·5, §5, §8
 *
 * §8-2 소진 우선순위: 무료적립 → 구독풀 → 응원선물 → 충전 (만료성 자원 우선).
 * §8-4 채팅 사후 차감: 잔액 부족 → deficit 기록 → 다음 충전 시 우선 상계.
 *
 * 본 정책은 순수 함수 — 잔액 입력을 받아 "어느 출처에서 얼마 소진"을 계산한다.
 * DB 트랜잭션은 application 레이어(charge-points.usecase)가 수행.
 * USER-SOFT-DELETE 의 user-soft-delete-policy.ts 패턴 차용 (순수 도메인 정책).
 *
 * 헥사고날상 domain 순수 영역 — Prisma/NestJS import 0건.
 */

import {
  CreditSource,
  CREDIT_CONSUMPTION_ORDER,
} from '@domain/model/credit-source'

/** 출처별 잔액 (4 출처) — Author 4 필드 캐시와 동형 */
export interface SourceBalances {
  free: number
  subscription: number
  gift: number
  charged: number
}

/** 소진 계산 결과 */
export interface ConsumptionPlan {
  /** 출처별 차감액 (양수 — 차감할 금액) */
  spentBySource: Record<CreditSource, number>
  /** 4 출처에서 실제 차감된 총액 */
  totalSpent: number
  /**
   * 외상 발생분 (잔액 부족분).
   * 0 = 정상 / 양수 = 4 출처 전부 소진 후에도 부족 → deficitPoints 에 누적.
   */
  deficitIncurred: number
}

/**
 * 소진 우선순위에 따라 차감 계획 계산 (§8-2).
 *
 * 무료적립 → 구독풀 → 응원선물 → 충전 순으로 차감.
 * 4 출처를 다 써도 부족하면 부족분을 deficitIncurred 로 반환 (사후 차감 — §8-4).
 *
 * @param balances 현재 출처별 잔액
 * @param amount 차감할 총 포인트 (양수)
 * @returns 차감 계획 (출처별 차감액 + 외상 발생분)
 * @throws Error amount 가 음수 또는 비정수
 */
export function planConsumption(
  balances: SourceBalances,
  amount: number,
): ConsumptionPlan {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`차감액은 0 이상 정수여야 합니다: ${amount}`)
  }

  const spentBySource: Record<CreditSource, number> = {
    free: 0,
    subscription: 0,
    gift: 0,
    charged: 0,
  }

  let remaining = amount
  let totalSpent = 0

  for (const source of CREDIT_CONSUMPTION_ORDER) {
    if (remaining <= 0) break
    const available = balances[source]
    const take = Math.min(available, remaining)
    if (take > 0) {
      spentBySource[source] = take
      totalSpent += take
      remaining -= take
    }
  }

  // 4 출처를 다 소진해도 남은 remaining = 외상 발생분.
  return {
    spentBySource,
    totalSpent,
    deficitIncurred: remaining,
  }
}

/**
 * 충전 시 deficit(외상) 우선 상계 계산 (§8-4).
 *
 * §8-2 소진 우선순위상 충전이 마지막이지만, deficit 상계는 충전 즉시 최우선(외상 갚기).
 * 충전액에서 먼저 외상을 갚고, 남은 금액만 pointsCharged 로 적립.
 *
 * @param chargeAmount 충전 포인트 (양수)
 * @param currentDeficit 현재 외상 잔액 (양수 — Author.deficitPoints)
 * @returns settledDeficit(상계된 외상), remainingCharge(적립될 충전 잔액), remainingDeficit(상계 후 외상)
 * @throws Error 입력이 음수 또는 비정수
 */
export function settleDeficitOnCharge(
  chargeAmount: number,
  currentDeficit: number,
): {
  settledDeficit: number
  remainingCharge: number
  remainingDeficit: number
} {
  if (!Number.isInteger(chargeAmount) || chargeAmount < 0) {
    throw new Error(`충전액은 0 이상 정수여야 합니다: ${chargeAmount}`)
  }
  if (!Number.isInteger(currentDeficit) || currentDeficit < 0) {
    throw new Error(`외상 잔액은 0 이상 정수여야 합니다: ${currentDeficit}`)
  }

  const settledDeficit = Math.min(chargeAmount, currentDeficit)
  return {
    settledDeficit,
    remainingCharge: chargeAmount - settledDeficit,
    remainingDeficit: currentDeficit - settledDeficit,
  }
}

/**
 * 충전 적립 1건의 ledger 박제 계획 (CC-2a — 案 1 트랜잭션 통합용).
 *
 * 진단 정본: `reports/CREDIT_CORE_DIAGNOSIS.md` §1-A / §6-2 (settleDeficit 완결).
 *
 * `settleDeficitOnCharge`를 재사용해 "충전 → deficit 우선 상계 → 남은 충전액 적립"의
 * 두 ledger row(deficit_settle / charged earn) 와 Author 캐시 델타를 한 번에 계산한다.
 *
 * 본 함수는 순수 함수 — DB·tx 미접촉. `PrismaPaymentRepository.completePaymentWithPoints`
 * 와 `PrismaCreditLedgerRepository`(향후 재사용)가 동일 헬퍼를 호출해 로직 중복 0건
 * (案 1 단점 해소 — 계획 §2-2 권고 사유 4).
 *
 * 회계 정합: `charged` 출처 캐시는 "남은 충전 적립분(remainingCharge)"만큼만 가산한다.
 * deficit 상계분(settledDeficit)은 외상을 갚는 것이므로 캐시 잔액으로 적립되지 않는다
 * — `settleDeficit` 어댑터(`prisma-credit-ledger.repository.ts:222-262`)의 회계와 동일.
 *
 * @param chargeAmount 충전 패키지 총 포인트 (기본 + 보너스 — §8-5, 양수)
 * @param currentDeficit 현재 외상 잔액 (Author.deficitPoints, 0 이상)
 * @param currentChargedCache 현재 충전 출처 캐시 (Author.pointsCharged, 0 이상)
 * @returns 충전 적립 ledger 박제 계획
 * @throws Error 입력이 음수 또는 비정수
 */
export function computeChargeLedgerEntries(
  chargeAmount: number,
  currentDeficit: number,
  currentChargedCache: number,
): {
  /** 상계된 외상 (deficit_settle ledger amount 의 절대값) */
  settledDeficit: number
  /** charged 출처에 실제 적립되는 충전 잔액 (earn ledger amount) */
  remainingCharge: number
  /** 상계 후 외상 잔액 — Author.deficitPoints 갱신값 */
  remainingDeficit: number
  /** 적립 후 충전 출처 캐시 — Author.pointsCharged 갱신값 */
  newChargedCache: number
} {
  if (!Number.isInteger(currentChargedCache) || currentChargedCache < 0) {
    throw new Error(`충전 캐시는 0 이상 정수여야 합니다: ${currentChargedCache}`)
  }
  // settleDeficitOnCharge 가 chargeAmount/currentDeficit 음수·비정수 검증을 수행.
  const { settledDeficit, remainingCharge, remainingDeficit } = settleDeficitOnCharge(
    chargeAmount,
    currentDeficit,
  )
  return {
    settledDeficit,
    remainingCharge,
    remainingDeficit,
    // charged 캐시는 외상 상계분 제외 — 남은 충전액만 가산
    newChargedCache: currentChargedCache + remainingCharge,
  }
}

/**
 * 신규 채팅 차단 여부 판정 (게이트 5(c)).
 *
 * 사후 차감 구조이므로 응답 자체는 생성된다 — 하지만 외상이 상한에 도달했으면
 * "다음" 채팅 요청을 사전 차단해 충전을 유도한다.
 *
 * @param currentDeficit 현재 외상 잔액 (양수)
 * @param deficitLimit 외상 상한 절대값 (기본 10,000 — credit-system-setting 의 loadDeficitLimit)
 * @returns true = 차단 (충전 필요) / false = 채팅 허용
 */
export function isChatBlockedByDeficit(
  currentDeficit: number,
  deficitLimit: number,
): boolean {
  return currentDeficit >= deficitLimit
}

/** SourceBalances 의 총 잔액 (4 출처 합) */
export function totalBalance(balances: SourceBalances): number {
  return (
    balances.free +
    balances.subscription +
    balances.gift +
    balances.charged
  )
}
