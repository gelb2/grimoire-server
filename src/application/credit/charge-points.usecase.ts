import {
  Injectable,
  Inject,
  BadRequestException,
  Logger,
} from '@nestjs/common'
import { CreditLedgerPort } from '@domain/port/outbound/credit-ledger.port'
import { SystemSettingRepositoryPort } from '@domain/port/outbound/system-setting-repository.port'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import {
  resolveChatChargeTier,
  ANALYSIS_POINT_COST,
  THEME_POINT_COST,
} from '@domain/model/chat-charge-tier'
import {
  loadChatChargeTiers,
  loadDeficitLimit,
} from '@domain/model/credit-system-setting'
import { isChatBlockedByDeficit } from '@domain/policy/credit-consumption-policy'
import { SpendResult } from '@domain/port/outbound/credit-ledger.port'
import { CreditSource, CREDIT_CONSUMPTION_ORDER } from '@domain/model/credit-source'

/**
 * 크레딧 개편 I Phase (2026-05-17) — 포인트 차감 UseCase.
 *
 * 정본: research/CREDIT_PRICING_OVERHAUL_PLAN.md §8-4
 *       .claude/state/sprint-credit-overhaul-s-phase-draft.md §5, §8-1~§8-3
 *
 * 3 차감 경로:
 *   - chargeChatTurn: 채팅 사후 차감 (4구간 정액 — API 응답 후 inputTokens 로 구간 판정)
 *   - chargeAnalysis: 분석 사전 차감 (정액 2,440pt — 원가 고정, 잔액 부족 시 거부)
 *   - chargeTheme:    테마 사전 차감 (정액 590pt — 일일 무료 초과분)
 *
 * §8-8 CRITICAL:
 *   #1 차감 N 은 chat-charge-tier.ts / SystemSetting 정본 — 본 usecase 재산출 0건
 *   #3 채팅 차감은 inputTokens(토큰 실측 필드) 필수 — 없으면 차감 불가
 *   #4 4구간 — resolveChatChargeTier 가 강제
 *
 * 헥사고날 — application 레이어. PrismaService import 0건 (CreditLedgerPort 경유).
 */
@Injectable()
export class ChargePointsUseCase {
  private readonly logger = new Logger(ChargePointsUseCase.name)
  /**
   * F-11 (2026-07-11) — 채팅 사후 차감 유계 재시도.
   * 사후 차감(응답 이미 제공)이라 spend 유실 = revenue leak(§0). 일시적 DB 오류
   * (deadlock/serialization/blip)를 유계 재시도로 흡수해 정규 spend 경로를 유지한다.
   */
  private static readonly CHAT_CHARGE_MAX_ATTEMPTS = 3
  private static readonly CHAT_CHARGE_RETRY_BASE_MS = 50

  constructor(
    @Inject('CreditLedgerPort')
    private readonly ledger: CreditLedgerPort,
    @Inject('SystemSettingRepositoryPort')
    private readonly settingRepo: SystemSettingRepositoryPort,
    @Inject('AuthorRepositoryPort')
    private readonly authorRepo: AuthorRepositoryPort,
  ) {}

  /**
   * 채팅 1턴 사후 차감 (§8-4 — 4구간 정액).
   *
   * 호출 시점: Claude API 응답 수신 후 (inputTokens 가 usage 로 확정된 뒤).
   * 사후 차감이므로 응답은 이미 생성됨 — 잔액 부족이면 deficit(외상) 누적.
   *
   * @param authorId 차감 대상
   * @param inputTokens API 응답 usage.input_tokens (구간 판정 기준)
   * @param relatedId ChatMessage(assistant) id — 감사 약결합
   * @returns 차감 결과 (출처별 차감액 + deficit + 구간 정보)
   */
  async chargeChatTurn(
    authorId: string,
    inputTokens: number,
    relatedId?: string,
  ): Promise<SpendResult & { tier: string; chargedPoints: number }> {
    // §8-8 #3 — 토큰 실측 필드 없으면 차감 불가
    if (
      inputTokens === null ||
      inputTokens === undefined ||
      !Number.isFinite(inputTokens) ||
      inputTokens < 0
    ) {
      throw new BadRequestException(
        '채팅 차감을 위한 input 토큰 수가 유효하지 않습니다',
      )
    }

    // 동적 4구간 정의 로드 (SystemSetting → §8 기본값 폴백)
    const settings = await this.settingRepo.findByPrefix('chat.')
    const tiers = loadChatChargeTiers(settings)
    const tierDef = resolveChatChargeTier(inputTokens, tiers)

    // F-11 — 잔액 부족은 spend 내부가 deficit(외상)로 흡수(throw 아님) → 재시도 대상은 DB 오류뿐.
    // spend 는 단일 $transaction 이라 throw=rollback → 재시도 이중과금 없음(희박한 커밋-ack-loss
    // 예외만, 소액). 유계 재시도 소진 시 throw → 호출자(chat.usecase)가 durable AuditLog 재조정.
    const result = await this.spendChatChargeWithRetry(authorId, tierDef, relatedId)

    if (result.deficitIncurred > 0) {
      this.logger.warn(
        `채팅 차감 deficit 발생 (authorId=${authorId}, tier=${tierDef.tier}, ` +
          `charged=${tierDef.points}, deficit=${result.deficitIncurred})`,
      )
    }

    return {
      ...result,
      tier: tierDef.tier,
      chargedPoints: tierDef.points,
    }
  }

  /**
   * F-11 — 채팅 사후 차감 spend 를 유계 재시도한다.
   * 일시적 DB 오류(deadlock/serialization/connection blip)를 흡수 → 정규 spend 경로 유지
   * (잔액 부족 시 spend 가 deficit 를 정규 생성 = 불변식 보존). 재시도 소진 시 마지막 오류 throw.
   */
  private async spendChatChargeWithRetry(
    authorId: string,
    tierDef: { tier: string; points: number },
    relatedId?: string,
  ): Promise<SpendResult> {
    let lastErr: unknown
    for (let attempt = 1; attempt <= ChargePointsUseCase.CHAT_CHARGE_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.ledger.spend({
          authorId,
          amount: tierDef.points,
          reason: `chat_turn:${tierDef.tier}`,
          relatedId,
        })
      } catch (e: unknown) {
        lastErr = e
        if (attempt < ChargePointsUseCase.CHAT_CHARGE_MAX_ATTEMPTS) {
          this.logger.warn(
            `채팅 차감 재시도 ${attempt}/${ChargePointsUseCase.CHAT_CHARGE_MAX_ATTEMPTS - 1} ` +
              `(authorId=${authorId}, tier=${tierDef.tier}): ${e instanceof Error ? e.message : String(e)}`,
          )
          await new Promise((r) =>
            setTimeout(r, ChargePointsUseCase.CHAT_CHARGE_RETRY_BASE_MS * attempt),
          )
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  /**
   * 신규 채팅 차단 여부 사전 판정 (게이트 5(c)).
   *
   * 사후 차감 구조이므로 응답 자체는 생성되지만, 외상이 상한(기본 -10,000pt)에
   * 도달했으면 다음 채팅 요청을 사전 차단해 충전을 유도한다.
   *
   * @param authorId 검사 대상
   * @returns true = 차단 (충전 필요)
   */
  async isChatBlocked(authorId: string): Promise<boolean> {
    const settings = await this.settingRepo.findByPrefix('credit.')
    const deficitLimit = loadDeficitLimit(settings)
    const balance = await this.ledger.getBalance(authorId)
    return isChatBlockedByDeficit(balance.deficit, deficitLimit)
  }

  /**
   * 분석 1회 사전 차감 (§8-4 — 정액 2,440pt).
   *
   * 분석은 원가 고정(1회=예측가능) → 사전 차감. 잔액 부족 시 실행 거부(deficit 불가).
   *
   * @param authorId 차감 대상
   * @param relatedId AnalysisReport id (있으면)
   * @returns SpendResult — 환불 시 출처별 복원을 위해 spentBySource 를 호출자가 보유 (CC-1 §5-D)
   * @throws BadRequestException 잔액 부족
   */
  async chargeAnalysis(authorId: string, relatedId?: string): Promise<SpendResult> {
    const balance = await this.ledger.getBalance(authorId)
    if (balance.available < ANALYSIS_POINT_COST) {
      throw new BadRequestException(
        `AI 분석은 ${ANALYSIS_POINT_COST} 포인트가 필요합니다. 포인트가 부족합니다.`,
      )
    }
    const result = await this.ledger.spend({
      authorId,
      amount: ANALYSIS_POINT_COST,
      reason: 'novel_analysis',
      relatedId,
    })
    // 사전 잔액 검증을 통과했으므로 deficit 은 정상 시 0 —
    // 동시성으로 발생 가능 시 방어적 로그 (실행은 진행, 환불 분기는 호출자)
    if (result.deficitIncurred > 0) {
      this.logger.warn(
        `분석 차감 중 deficit 발생 (동시성 — authorId=${authorId}, deficit=${result.deficitIncurred})`,
      )
    }
    return result
  }

  /**
   * 분석 실패 시 환불 — 차감 포인트를 출처별로 복원 (project_analysis_refund_gap 정합).
   *
   * 크레딧 개편 CC-1 §5-D — 구 구현은 전액 source='charged' 로 복원해
   * 무료적립/구독풀 차감분이 충전으로 둔갑(CAC/COGS 회계 왜곡)했다.
   * chargeAnalysis 가 반환한 spentBySource 를 받아 출처별로 정확히 복원한다.
   *
   * @param spentBySource chargeAnalysis 의 SpendResult.spentBySource.
   *        미전달 시(구 호출 호환) 전액 charged 복원으로 폴백.
   * @param deficitIncurred chargeAnalysis 의 SpendResult.deficitIncurred (F-10, 2026-07-11).
   *        분석 사전 잔액 검증을 통과했으나 동시 요청 race 로 spend 시 deficit(외상)이 발생한
   *        경우, 실차감 출처 복원만으로는 그 외상이 잔존한다(실패한 분석인데 외상 ≤2,440pt 남음).
   *        settleDeficit 로 이 트랜잭션이 만든 외상도 역전한다(현재 deficit 상한까지 capped —
   *        타 트랜잭션 외상 침범 없음, 이중 감액 없음).
   */
  async refundAnalysis(
    authorId: string,
    relatedId?: string,
    spentBySource?: Record<CreditSource, number>,
    deficitIncurred?: number,
  ): Promise<void> {
    if (!spentBySource) {
      // spentBySource 미전달 → 구 동작 폴백 (전액 charged)
      await this.ledger.earn({
        authorId,
        source: 'charged',
        amount: ANALYSIS_POINT_COST,
        reason: 'novel_analysis_refund',
        relatedId,
      })
    } else {
      // 출처별 복원 — 차감된 출처에 같은 금액을 되돌린다 (0 인 출처는 skip)
      for (const source of CREDIT_CONSUMPTION_ORDER) {
        const amount = spentBySource[source] ?? 0
        if (amount > 0) {
          await this.ledger.earn({
            authorId,
            source,
            amount,
            reason: 'novel_analysis_refund',
            relatedId,
          })
        }
      }
    }

    // F-10 — 이 차감이 동시성으로 만든 deficit(외상)도 역전 (실패 분석의 잔여 외상 제거).
    if (deficitIncurred && deficitIncurred > 0) {
      await this.ledger.settleDeficit(authorId, deficitIncurred)
    }
  }

  /**
   * 테마 1회 사전 차감 (§8-4 — 정액 590pt, 일일 무료 초과분).
   *
   * @param authorId 차감 대상
   * @returns SpendResult — 환불 시 출처별 복원을 위해 spentBySource 를 호출자가 보유 (F-9, CC-1 §5-D).
   * @throws BadRequestException 잔액 부족
   */
  async chargeTheme(authorId: string, relatedId?: string): Promise<SpendResult> {
    const balance = await this.ledger.getBalance(authorId)
    if (balance.available < THEME_POINT_COST) {
      throw new BadRequestException(
        `테마 생성은 ${THEME_POINT_COST} 포인트가 필요합니다. 포인트가 부족합니다.`,
      )
    }
    return this.ledger.spend({
      authorId,
      amount: THEME_POINT_COST,
      reason: 'theme_generate',
      relatedId,
    })
  }

  /**
   * 테마 생성 실패 시 환불 — 차감 포인트(590pt)를 출처별로 정확히 복원 (F-9, 2026-07-11).
   *
   * 크레딧 개편 CC-1 (2026-05-19) — 구 GenerateThemeUseCase 의 'theme_generate_refund' 보존.
   * 구 구현은 chargeTheme 이 void 라 spentBySource 미보존 → 항상 source='charged' 복원해
   * subscription/free/gift 차감분이 충전으로 둔갑(§0 COGS/CAC 회계 왜곡 + 만료 정책 불일치).
   * refundAnalysis §5-D 와 동일 패턴 — chargeTheme 의 SpendResult.spentBySource 를 받아 복원.
   *
   * @param spentBySource chargeTheme 의 SpendResult.spentBySource.
   *        미전달 시(구 호출 호환) 전액 charged 복원으로 폴백.
   */
  async refundTheme(
    authorId: string,
    relatedId?: string,
    spentBySource?: Record<CreditSource, number>,
  ): Promise<void> {
    // spentBySource 미전달 → 구 동작 폴백 (전액 charged)
    if (!spentBySource) {
      await this.ledger.earn({
        authorId,
        source: 'charged',
        amount: THEME_POINT_COST,
        reason: 'theme_generate_refund',
        relatedId,
      })
      return
    }
    // 출처별 복원 — 차감된 출처에 같은 금액을 되돌린다 (0 인 출처는 skip)
    for (const source of CREDIT_CONSUMPTION_ORDER) {
      const amount = spentBySource[source] ?? 0
      if (amount > 0) {
        await this.ledger.earn({
          authorId,
          source,
          amount,
          reason: 'theme_generate_refund',
          relatedId,
        })
      }
    }
  }
}
