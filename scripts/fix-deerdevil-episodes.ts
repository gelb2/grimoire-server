/**
 * DeerDevil 에피소드 slug/type/orderNum 수정 스크립트
 *
 * 기존 episode-1~15 형식의 slug를 올바른 형식으로 변경하고
 * type 필드를 추가한다.
 *
 * 실행: cd grimoire-server && npx tsx scripts/fix-deerdevil-episodes.ts
 */

import { PrismaClient } from '@prisma/client'

// DATABASE_URL 환경변수 확인
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL 환경변수가 필요합니다.')
  console.error('실행 예시: DATABASE_URL="postgresql://..." npx tsx scripts/fix-deerdevil-episodes.ts')
  process.exit(1)
}

const prisma = new PrismaClient()

const EPISODE_MAP = [
  { match: '일러두기', slug: 'preface', type: 'preface', orderNum: 0 },
  { match: '선녀와 나무꾼', slug: 'ep1', type: 'episode', orderNum: 1 },
  { match: '여우누이전', slug: 'ep2', type: 'episode', orderNum: 2 },
  { match: '판교의 사승우', slug: 'ep3', type: 'episode', orderNum: 3 },
  { match: '금도끼', slug: 'ep4', type: 'episode', orderNum: 4 },
  { match: '개구리 왕자', slug: 'ep5', type: 'episode', orderNum: 5 },
  { match: '우렁각시', slug: 'ep6', type: 'episode', orderNum: 6 },
  { match: '바리데기', slug: 'ep7', type: 'episode', orderNum: 7 },
  { match: '손톱 먹은 쥐', slug: 'ep8', type: 'episode', orderNum: 8 },
  { match: '도리안 그레이', slug: 'ep9', type: 'episode', orderNum: 9 },
  { match: '장화홍련전', slug: 'ep10', type: 'episode', orderNum: 10 },
  { match: '이름 없는 괴물', slug: 'ep11', type: 'episode', orderNum: 11 },
  { match: '베를린 천사의 시', slug: 'ep12', type: 'episode', orderNum: 12 },
  { match: '브란덴부르크', slug: 'bonus1', type: 'bonus', orderNum: 13 },
  { match: '후기', slug: 'afterword', type: 'afterword', orderNum: 14 },
]

async function main() {
  console.log('=== DeerDevil 에피소드 수정 스크립트 ===\n')

  // 1단계: type 컬럼이 없으면 추가
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'episode'`
    )
    console.log('[1/3] type 컬럼 확인/추가 완료')
  } catch (err) {
    console.log('[1/3] type 컬럼 이미 존재하거나 추가 완료')
  }

  // 2단계: deerdevil 작가의 deerdevil 작품 찾기
  const author = await prisma.author.findUnique({ where: { slug: 'deerdevil' } })
  if (!author) {
    console.error('ERROR: deerdevil 작가를 찾을 수 없습니다')
    process.exit(1)
  }

  const work = await prisma.work.findUnique({
    where: { authorId_slug: { authorId: author.id, slug: 'deerdevil' } },
  })
  if (!work) {
    console.error('ERROR: deerdevil 작품을 찾을 수 없습니다')
    process.exit(1)
  }

  // 3단계: 에피소드 목록 가져오기
  const episodes = await prisma.episode.findMany({
    where: { workId: work.id },
    orderBy: { orderNum: 'asc' },
  })

  console.log(`[2/3] 에피소드 ${episodes.length}개 발견\n`)

  // 4단계: title 매칭으로 각 에피소드 업데이트
  // 충돌 방지: 임시 slug로 먼저 변경 후 최종 slug로 변경
  console.log('--- Phase A: 임시 slug 할당 ---')
  for (const ep of episodes) {
    const tempSlug = `__temp_${ep.id.slice(0, 8)}`
    await prisma.$executeRawUnsafe(
      `UPDATE episodes SET slug = $1 WHERE id = $2`,
      tempSlug,
      ep.id,
    )
    console.log(`  ${ep.slug} → ${tempSlug} (${ep.title.slice(0, 20)}...)`)
  }

  console.log('\n--- Phase B: 최종 slug/type/orderNum 할당 ---')
  let updated = 0
  let unmatched = 0

  for (const ep of episodes) {
    const mapping = EPISODE_MAP.find((m) => ep.title.includes(m.match))
    if (!mapping) {
      console.warn(`  WARNING: 매칭 실패 — "${ep.title}"`)
      unmatched++
      continue
    }

    await prisma.$executeRawUnsafe(
      `UPDATE episodes SET slug = $1, type = $2, order_num = $3 WHERE id = $4`,
      mapping.slug,
      mapping.type,
      mapping.orderNum,
      ep.id,
    )
    console.log(`  ${ep.title.slice(0, 25).padEnd(25)} → slug=${mapping.slug}, type=${mapping.type}, orderNum=${mapping.orderNum}`)
    updated++
  }

  console.log(`\n[3/3] 완료: ${updated}개 업데이트, ${unmatched}개 미매칭`)

  // 5단계: 검증
  console.log('\n=== 검증 ===')
  const result = await prisma.episode.findMany({
    where: { workId: work.id },
    orderBy: { orderNum: 'asc' },
    select: { slug: true, title: true, orderNum: true, type: true },
  })

  for (const r of result) {
    console.log(`  [${r.orderNum}] ${r.slug.padEnd(12)} ${r.type.padEnd(10)} ${r.title.slice(0, 30)}`)
  }

  console.log('\n=== 완료 ===')
}

main()
  .catch((e) => {
    console.error('스크립트 실행 중 오류:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
