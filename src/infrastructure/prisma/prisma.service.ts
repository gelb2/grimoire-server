import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import { applySoftDeleteExtension } from '@adapter/outbound/persistence/prisma-soft-delete.middleware'

/**
 * PrismaService — NestJS DI 진입점.
 *
 * USER-SOFT-DELETE sprint (2026-05-15) — Author soft delete 자동 변환.
 *
 * Prisma 6.x 정합 (revision 159 ActivationFailed hotfix):
 * - Prisma 5.x `$use` middleware 는 6.x 에서 제거됨 (`prisma.$use` === undefined) →
 *   Client Extensions (`$extends`) 로 마이그레이션.
 * - `$extends` 는 **새 client 인스턴스**를 반환한다 (원본 in-place 변경 X).
 *   본 서비스는 `onModuleInit` 에서 확장본을 만든 뒤, 확장본의 **모델 delegate**
 *   (author / work / ...) 를 `this` 에 덮어써서 모든 Repository 의
 *   `this.prisma.<model>.<op>()` 호출이 코드 변경 없이 확장 delegate 를 거치게 한다.
 * - `$queryRaw` / `$executeRaw` / `$transaction` 등 client-level 메서드는
 *   PrismaClient 상속본 그대로 유지된다 (raw query 는 extension 미적용 — Author
 *   Repository 의 restore / hardDelete / findDeleted* 우회 정합).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** soft delete Extension 이 중복 적용되지 않도록 1회만 수행하기 위한 가드 */
  private softDeleteApplied = false

  async onModuleInit() {
    await this.$connect()
    this.applySoftDelete()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }

  /**
   * Author soft delete Client Extension 을 적용하고, 확장본의 모델 delegate 를
   * `this` 에 덮어쓴다. (Prisma 6.x — `$use` 대체)
   *
   * - `applySoftDeleteExtension(this)` 는 동일 DB 연결을 공유하는 확장 client 를 반환.
   * - 확장본의 각 모델 delegate (author/work/...) 를 `this` 의 동명 프로퍼티로 복사.
   *   → Repository 가 `PrismaService` 를 그대로 주입받아도 확장 delegate 가 동작.
   * - 모델 delegate 만 교체 — `$transaction`/`$queryRaw` 등은 PrismaClient 원본 유지.
   *
   * 별도 인스턴스화(테스트 등)에서도 안전하게 호출 가능하도록 public + 멱등.
   */
  applySoftDelete(): void {
    if (this.softDeleteApplied) return

    const extended = applySoftDeleteExtension(this)
    const extendedRecord = extended as unknown as Record<string, unknown>

    // dmmf 의 모델 목록(파스칼 → lowerCamel)을 확장본 delegate 로 교체
    for (const model of Prisma.dmmf.datamodel.models) {
      const key = model.name.charAt(0).toLowerCase() + model.name.slice(1)
      const delegate = extendedRecord[key]
      if (delegate && typeof delegate === 'object') {
        Object.defineProperty(this, key, {
          value: delegate,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      }
    }

    this.softDeleteApplied = true
  }
}
