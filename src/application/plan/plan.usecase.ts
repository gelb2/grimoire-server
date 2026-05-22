import { Injectable, Inject, Optional, NotFoundException, BadRequestException } from '@nestjs/common'
import { AuthorRepositoryPort } from '@domain/port/outbound/author-repository.port'
import { ThemeRepositoryPort } from '@domain/port/outbound/theme-repository.port'
import { MembershipPlanPort } from '@domain/port/outbound/membership-plan.port'
import { isMembershipExpired } from '@domain/model/plan'
import {
  resolveTierOrFree,
  isMembershipTier,
  MEMBERSHIP_THEME_SLOTS,
} from '@domain/model/membership-tier'

/**
 * 크레딧 개편 CC-5 (2026-05-22, HIGH-1 案 B) — tier 정본을 MembershipPlan 으로 이행.
 *
 * 구 Author.plan(deprecated) 직접 읽기/쓰기를 전부 제거:
 *  - getPlanInfo: `Author.plan`/`planExpireAt`/`THEME_SLOT_LIMITS` → `MembershipPlanPort.getPlan`
 *  - activatePlan: `authorRepo.updatePlan` 직접 SQL → `MembershipPlanPort.changeTier`
 *    (changeTier 가 案 A 미러로 `Author.plan` 도 동기 — DROP 전까지 정합)
 *  - handleExpiry: `Author.plan` → `MembershipPlanPort.getPlan` 만기 판정
 */
@Injectable()
export class PlanUseCase {
  constructor(
    @Inject('AuthorRepositoryPort') private readonly authorRepo: AuthorRepositoryPort,
    @Inject('ThemeRepositoryPort') private readonly themeRepo: ThemeRepositoryPort,
    // CC-5 (HIGH-1 案 B) — tier 정본 출처 + 등급 변경 단일 진입점.
    // Optional — 미주입 시 free 폴백(BACKWARD COMPATIBLE).
    @Optional()
    @Inject('MembershipPlanPort')
    private readonly membershipRepo: MembershipPlanPort | null = null,
  ) {}

  /** 플랜 정보 조회 */
  async getPlanInfo(authorId: string): Promise<{
    plan: string
    planExpireAt: Date | null
    isExpired: boolean
    slotLimit: number
    slottedCount: number
    totalThemes: number
  }> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    // CC-5 (HIGH-1 案 B) — tier 정본을 MembershipPlan 으로 조회.
    const plan = this.membershipRepo ? await this.membershipRepo.getPlan(authorId) : null
    const tier = resolveTierOrFree(plan)
    const slottedCount = await this.themeRepo.countSlottedByAuthorId(authorId)
    const totalThemes = await this.themeRepo.countByAuthorId(authorId)

    return {
      // 응답 키 `plan`/`planExpireAt` 보존(web 호환) — 값은 MembershipPlan 정본.
      plan: tier,
      planExpireAt: plan?.expiresAt ?? null,
      isExpired: isMembershipExpired(plan),
      slotLimit: MEMBERSHIP_THEME_SLOTS[tier],
      slottedCount,
      totalThemes,
    }
  }

  /** 플랜 활성화 (관리자용 — 가격 미정이므로 수동 설정) */
  async activatePlan(authorId: string, plan: string, durationDays: number): Promise<void> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) throw new NotFoundException('작가를 찾을 수 없습니다')

    // CC-5 (HIGH-1 案 B) — 유효 등급은 MembershipTier 3종(free/pro/premium).
    if (!isMembershipTier(plan)) {
      throw new BadRequestException('유효하지 않은 플랜입니다. 사용 가능: free, pro, premium')
    }

    if (durationDays <= 0) {
      throw new BadRequestException('기간은 1일 이상이어야 합니다')
    }

    // CC-5 (HIGH-1 案 B) — 직접 SQL UPDATE 금지, changeTier 단일 진입점 경유.
    // changeTier 가 MembershipPlan.tier 정본 갱신 + 案 A 미러(Author.plan) 동기.
    if (!this.membershipRepo) {
      throw new BadRequestException('멤버십 모듈이 활성화되지 않았습니다')
    }
    await this.membershipRepo.changeTier(authorId, plan, new Date())
    // 슬롯은 자동 복원하지 않음 — 작가가 직접 테마를 슬롯에 배치
  }

  /** 만기 처리 — 모든 테마를 슬롯에서 해제 (지연 실행) */
  async handleExpiry(authorId: string): Promise<void> {
    const author = await this.authorRepo.findById(authorId)
    if (!author) return

    // CC-5 (HIGH-1 案 B) — 만기 판정을 MembershipPlan 정본으로.
    const plan = this.membershipRepo ? await this.membershipRepo.getPlan(authorId) : null
    if (isMembershipExpired(plan)) {
      await this.themeRepo.unslotAllByAuthorId(authorId)
    }
  }
}
