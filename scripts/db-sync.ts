/**
 * DB 동기화 스크립트 — source DB의 데이터를 target DB로 복사
 *
 * 사용법:
 *   npx tsx scripts/db-sync.ts prod dev
 *   npx tsx scripts/db-sync.ts prod inhouse
 *   npx tsx scripts/db-sync.ts inhouse dev
 */

import { PrismaClient } from '@prisma/client'

const PW = 'REMOVED_CREDENTIAL_010'
const ADMIN = 'grimoireadmin'

function getDbUrl(env: string): string {
  return `postgresql://${ADMIN}:${PW}@grimoire-db-${env}.postgres.database.azure.com:5432/grimoire?sslmode=require`
}

const TABLES = [
  'Author', 'Theme', 'Work', 'Episode', 'SocialAccount', 'SignupHistory',
  'CreditLog', 'Bookmark', 'ReadingProgress', 'Like', 'Subscription',
  'Comment', 'Payment', 'DailyView',
] as const

async function main() {
  const [source, target] = process.argv.slice(2)
  if (!source || !target) {
    console.error('사용법: npx tsx scripts/db-sync.ts [source] [target]')
    console.error('예: npx tsx scripts/db-sync.ts prod dev')
    process.exit(1)
  }
  if (source === target) {
    console.error('❌ source와 target이 같습니다')
    process.exit(1)
  }

  console.log(`╔══════════════════════════════════════╗`)
  console.log(`║   DB 동기화: ${source} → ${target}`)
  console.log(`╚══════════════════════════════════════╝`)

  const sourceDb = new PrismaClient({ datasources: { db: { url: getDbUrl(source) } } })
  const targetDb = new PrismaClient({ datasources: { db: { url: getDbUrl(target) } } })

  try {
    // 1. Source에서 데이터 읽기
    console.log(`\n[1/3] ${source} DB에서 데이터 읽기...`)
    const authors = await sourceDb.author.findMany()
    const themes = await sourceDb.theme.findMany()
    const works = await sourceDb.work.findMany()
    const episodes = await sourceDb.episode.findMany()
    const creditLogs = await sourceDb.creditLog.findMany()
    const dailyViews = await sourceDb.dailyView.findMany()

    console.log(`  authors: ${authors.length}, themes: ${themes.length}, works: ${works.length}, episodes: ${episodes.length}`)

    // 2. Target 데이터 삭제 (역순)
    console.log(`\n[2/3] ${target} DB 데이터 초기화...`)
    await targetDb.dailyView.deleteMany()
    await targetDb.comment.deleteMany()
    await targetDb.like.deleteMany()
    await targetDb.subscription.deleteMany()
    await targetDb.readingProgress.deleteMany()
    await targetDb.bookmark.deleteMany()
    await targetDb.payment.deleteMany()
    await targetDb.creditLog.deleteMany()
    await targetDb.episode.deleteMany()
    await targetDb.work.deleteMany()
    await targetDb.theme.deleteMany()
    await targetDb.socialAccount.deleteMany()
    await targetDb.signupHistory.deleteMany()
    await targetDb.author.deleteMany()
    console.log('  초기화 완료')

    // 3. Target에 데이터 삽입
    console.log(`\n[3/3] ${target} DB에 데이터 삽입...`)

    for (const a of authors) {
      await targetDb.author.create({ data: a })
    }
    console.log(`  authors: ${authors.length}`)

    for (const t of themes) {
      await targetDb.theme.create({ data: t as any })
    }
    console.log(`  themes: ${themes.length}`)

    for (const w of works) {
      await targetDb.work.create({ data: w as any })
    }
    console.log(`  works: ${works.length}`)

    for (const ep of episodes) {
      await targetDb.episode.create({ data: ep as any })
    }
    console.log(`  episodes: ${episodes.length}`)

    for (const cl of creditLogs) {
      await targetDb.creditLog.create({ data: cl })
    }
    console.log(`  creditLogs: ${creditLogs.length}`)

    for (const dv of dailyViews) {
      await targetDb.dailyView.create({ data: dv })
    }
    console.log(`  dailyViews: ${dailyViews.length}`)

    // 검증
    const count = await targetDb.author.count()
    console.log(`\n╔══════════════════════════════════════╗`)
    console.log(`║   완료: ${target} DB 작가 ${count}명`)
    console.log(`╚══════════════════════════════════════╝`)

  } finally {
    await sourceDb.$disconnect()
    await targetDb.$disconnect()
  }
}

main().catch((err) => { console.error('❌ 에러:', err.message); process.exit(1) })
