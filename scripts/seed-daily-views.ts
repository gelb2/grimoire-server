/**
 * 일별 조회수 시드 데이터 생성
 * 각 작품에 대해 최근 30일간 랜덤 조회수 (10~200) 생성
 *
 * 사용법:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/seed-daily-views.ts
 */

import { PrismaClient } from '@prisma/client'
import { requireLocalSeedTarget } from '../src/infrastructure/config/local-seed-target'

const prisma = new PrismaClient({
  datasources: { db: { url: requireLocalSeedTarget('DATABASE_URL', ['postgresql:', 'postgres:']) } },
})

async function main() {
  console.log('=== 일별 조회수 시드 데이터 생성 ===')

  const works = await prisma.work.findMany({ select: { id: true, title: true } })
  console.log(`작품 ${works.length}개 발견`)

  const now = new Date()
  let totalCreated = 0

  for (const work of works) {
    console.log(`  [${work.title}] 30일치 조회수 생성 중...`)

    for (let i = 0; i < 30; i++) {
      const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - i))
      const count = Math.floor(Math.random() * 191) + 10 // 10~200

      await prisma.dailyView.upsert({
        where: { workId_date: { workId: work.id, date } },
        create: { workId: work.id, date, count },
        update: { count },
      })
      totalCreated++
    }
  }

  console.log(`=== 완료: ${totalCreated}건 생성 ===`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
