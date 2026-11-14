/**
 * 통계 데이터 시드 — 작품별 조회수 + 좋아요 + 구독 + 북마크 생성
 * 사슴악마가 최고 인기/최고 조회수로 설정
 *
 * 사용법: DATABASE_URL="postgresql://..." npx tsx scripts/seed-stats.ts
 */
import { PrismaClient } from '@prisma/client'
import { requireLocalSeedTarget } from '../src/infrastructure/config/local-seed-target'

const prisma = new PrismaClient({
  datasources: { db: { url: requireLocalSeedTarget('DATABASE_URL', ['postgresql:', 'postgres:']) } },
})

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function main() {
  console.log('=== 통계 데이터 시드 ===')

  const authors = await prisma.author.findMany({
    where: { role: 'user' },
    select: { id: true, slug: true, name: true },
  })
  const works = await prisma.work.findMany({
    include: { episodes: { select: { id: true } }, author: { select: { slug: true } } },
  })

  console.log(`작가 ${authors.length}명, 작품 ${works.length}개`)

  const now = new Date()

  // 1. 일별 조회수 (30일) — 사슴악마 작품은 100~500, 나머지 10~100
  console.log('\n[1/4] 일별 조회수 생성...')
  let viewCount = 0
  for (const work of works) {
    const isDeerdevil = work.author.slug === 'deerdevil'
    const [min, max] = isDeerdevil ? [100, 500] : [5, 80]

    for (let i = 0; i < 30; i++) {
      const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - i))
      const count = rand(min, max)

      await prisma.dailyView.upsert({
        where: { workId_date: { workId: work.id, date } },
        create: { workId: work.id, date, count },
        update: { count },
      })
      viewCount++
    }

    // 작품 총 조회수도 업데이트
    const totalViews = isDeerdevil ? rand(5000, 15000) : rand(100, 2000)
    await prisma.work.update({ where: { id: work.id }, data: { viewCount: totalViews } })
  }
  console.log(`  조회수 ${viewCount}건`)

  // 2. 에피소드별 조회수 — 사슴악마 에피소드는 300~1500, 나머지 10~200
  console.log('\n[2/4] 에피소드 조회수 생성...')
  for (const work of works) {
    const isDeerdevil = work.author.slug === 'deerdevil'
    for (const ep of work.episodes) {
      const views = isDeerdevil ? rand(300, 1500) : rand(10, 200)
      await prisma.episode.update({ where: { id: ep.id }, data: { viewCount: views } })
    }
  }

  // 3. 좋아요 — 사슴악마 에피소드에 집중, 나머지 소량
  console.log('\n[3/4] 좋아요 생성...')
  let likeCount = 0
  for (const work of works) {
    const isDeerdevil = work.author.slug === 'deerdevil'
    const likesPerEp = isDeerdevil ? rand(5, 15) : rand(0, 3)

    for (const ep of work.episodes) {
      for (let j = 0; j < likesPerEp; j++) {
        const randomAuthor = authors[rand(0, authors.length - 1)]
        if (randomAuthor.id === work.authorId) continue // 자기 작품 좋아요 방지

        try {
          await prisma.like.create({
            data: {
              authorId: randomAuthor.id,
              episodeId: ep.id,
              ipAddress: `192.168.${rand(1, 254)}.${rand(1, 254)}`,
            },
          })
          likeCount++
        } catch { /* unique constraint — 무시 */ }
      }
    }
  }
  console.log(`  좋아요 ${likeCount}건`)

  // 4. 구독 — 사슴악마에 대부분의 작가가 구독
  console.log('\n[4/4] 구독 생성...')
  let subCount = 0
  const deerdevilAuthor = authors.find(a => a.slug === 'deerdevil')

  for (const author of authors) {
    // 다른 작가를 랜덤으로 1~3명 구독
    const targets = authors.filter(a => a.id !== author.id).sort(() => Math.random() - 0.5).slice(0, rand(1, 3))

    // 사슴악마는 반드시 포함
    if (deerdevilAuthor && author.id !== deerdevilAuthor.id && !targets.find(t => t.id === deerdevilAuthor.id)) {
      targets.push(deerdevilAuthor)
    }

    for (const target of targets) {
      try {
        await prisma.subscription.create({
          data: { subscriberId: author.id, targetAuthorId: target.id },
        })
        subCount++
      } catch { /* unique constraint — 무시 */ }
    }
  }
  console.log(`  구독 ${subCount}건`)

  console.log('\n=== 완료 ===')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
