/**
 * 최고관리자 계정 시드 스크립트
 * 실행: SEED_ADMIN_PASSWORD='strong-pw' npx tsx scripts/seed-admin.ts
 * 용도: 3환경 공통 — 이미 존재하면 role만 admin으로 업데이트
 *
 * 2026-04-25 변경: 평문 비번 제거 (보안 회수). SEED_ADMIN_PASSWORD env 필수.
 */
import { PrismaClient } from '@prisma/client'
import { requireLocalSeedTarget } from '../src/infrastructure/config/local-seed-target'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient({
  datasources: { db: { url: requireLocalSeedTarget('DATABASE_URL', ['postgresql:', 'postgres:']) } },
})

async function main() {
  const slug = process.env.SEED_ADMIN_SLUG
  const email = process.env.SEED_ADMIN_EMAIL
  const name = process.env.SEED_ADMIN_NAME || 'Local Administrator'
  const password = process.env.SEED_ADMIN_PASSWORD
  if (!password || !slug || !email) {
    throw new Error('SEED_ADMIN_PASSWORD, SEED_ADMIN_SLUG, SEED_ADMIN_EMAIL env 필수')
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const existing = await prisma.author.findUnique({ where: { slug } })

  if (existing) {
    // 이미 존재하면 role만 admin으로 업데이트
    await prisma.author.update({
      where: { id: existing.id },
      data: { role: 'admin', passwordHash },
    })
    console.log(`기존 계정 admin 승격: ${slug} (id: ${existing.id})`)
  } else {
    const admin = await prisma.author.create({
      data: {
        slug,
        email,
        name,
        passwordHash,
        role: 'admin',
        // CC-4 Phase 3 (2026-05-21) — `Author.credits` 컬럼 DROP. 신 4 출처 캐시는 schema @default(0).
        plan: 'premium',
      },
    })
    console.log(`관리자 계정 생성: ${slug} (id: ${admin.id})`)
  }

  console.log('관리자 준비 완료. 비밀번호는 출력하지 않습니다.')
}

main()
  .catch(() => {
    console.error('관리자 시드 실패. 설정과 DB 상태를 확인하세요.')
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
