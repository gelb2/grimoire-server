/**
 * 최고관리자 계정 시드 스크립트
 * 실행: npx tsx scripts/seed-admin.ts
 * 용도: 3환경 공통 — 이미 존재하면 role만 admin으로 업데이트
 */
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const slug = 'grimoireadmin'
  const email = 'admin@grimoire-book.com'
  const name = 'GrimoireAdmin'
  const password = 'REMOVED_CREDENTIAL_014'

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
        credits: 0,
        plan: 'premium',
      },
    })
    console.log(`관리자 계정 생성: ${slug} (id: ${admin.id})`)
  }

  console.log(`로그인: slug=${slug}, password=${password}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
