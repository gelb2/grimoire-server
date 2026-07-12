import { IsOptional, IsISO8601, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import { CreditBalance } from '@domain/port/outbound/credit-ledger.port'

/**
 * 크레딧 개편 I Phase (2026-05-17) — `/credits/balance` 응답 DTO.
 *
 * 정본: .claude/shared-contracts.md §30 CreditOverhaul.
 *
 * 도메인 `CreditBalance` 는 출처 4 필드가 flat(`free`/`subscription`/`gift`/`charged`)
 * 이나, web `grimoire-web/src/features/credits/point-balance.ts` 의 `normalizePointBalance`
 * 는 출처별 잔액을 `bySource` 중첩 객체로 받는다 (출처 분해 자동 활성 트리거).
 * 본 DTO 는 도메인 → web 계약 형태로 변환한다.
 */
export class CreditBalanceResponseDto {
  /** 실사용 가능 포인트 (total - deficit) */
  available!: number
  /** 4 출처 합 */
  total!: number
  /** 외상 (채팅 사후 차감 시 잔액 부족분) */
  deficit!: number
  /** 출처별 잔액 — web normalizePointBalance 가 출처 분해에 사용 */
  bySource!: {
    /** 무료 적립 (가입·첫 작품) */
    free: number
    /** 구독 월 풀 */
    subscription: number
    /** 응원 선물 수령 */
    gift: number
    /** 충전 (Polar 패키지) */
    charged: number
  }
}

/**
 * `GET /credits/logs` 쿼리 파라미터 DTO (F-21 — brightMall #1).
 *
 * 전부 Optional — 무파라미터 호출 시 기존 동작(최신순 100건) 하위호환.
 * 전역 ValidationPipe `transform:true` 로 문자열 쿼리를 숫자로 coercion(@Type),
 * `forbidNonWhitelisted` 로 미허용 쿼리는 400.
 */
export class CreditLogsQueryDto {
  /** 기간 시작 (ISO8601, createdAt gte) */
  @IsOptional() @IsISO8601() from?: string
  /** 기간 끝 (ISO8601, createdAt lte) */
  @IsOptional() @IsISO8601() to?: string
  /** 페이지 크기 (1~100, 기본 100) */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number
  /** 오프셋 페이지네이션 (skip, 0 이상) */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number
}

/** 도메인 CreditBalance → `/credits/balance` 응답 DTO */
export function toCreditBalanceResponse(
  balance: CreditBalance,
): CreditBalanceResponseDto {
  return {
    available: balance.available,
    total: balance.total,
    deficit: balance.deficit,
    bySource: {
      free: balance.free,
      subscription: balance.subscription,
      gift: balance.gift,
      charged: balance.charged,
    },
  }
}
