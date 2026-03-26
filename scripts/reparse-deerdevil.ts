/**
 * DeerDevil 에피소드 재파싱 스크립트
 *
 * 원본 MD 파일을 DeerDevil 파서(chapter, refrain, italic, epilogue 등)로
 * 다시 파싱하여 DB의 blocks 필드를 업데이트한다.
 *
 * 실행: npx tsx scripts/reparse-deerdevil.ts
 */

import { PrismaClient } from '@prisma/client'
import { parseFrontmatter, parseEpisodeBlocks, parsePreface, parseAfterword } from '../src/lib/md-parser'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { Block } from '../src/domain/model/block'

// Azure dev DB에 직접 연결 (.env의 로컬 DB URL 무시)
const AZURE_DB_URL =
  'postgresql://grimoireadmin:REMOVED_CREDENTIAL_009@grimoire-db-dev.postgres.database.azure.com:5432/grimoire?sslmode=require'

const prisma = new PrismaClient({
  datasources: { db: { url: AZURE_DB_URL } },
})

const MD_DIR = join(__dirname, '../../grimoire-web/DeerDevil_MDfiles')
const AUTHOR_SLUG = 'deerdevil'
const WORK_SLUG = 'deerdevil'

// ── MD 파일 정렬용 순서 ──

function sortOrder(type: string, num?: string): number {
  if (type === 'preface') return -1
  if (type === 'afterword') return 999
  if (type === 'bonus') {
    // bonus1 → 100, bonus2 → 101...
    const n = parseInt((num ?? '').replace(/\D/g, '') || '0', 10)
    return 100 + n
  }
  const n = parseInt(num ?? '0', 10)
  return isNaN(n) ? 50 : n
}

// ── 에피소드 타입별 블록 파싱 ──

function parseBlocksByType(
  type: string,
  body: string,
): { title: string; blocks: Block[] } {
  if (type === 'preface') {
    const { paragraphs, lastLine } = parsePreface(body)
    // preface를 블록으로 변환
    const blocks: Block[] = []
    for (const p of paragraphs) {
      blocks.push({ type: 'paragraph', text: p })
    }
    if (lastLine) {
      blocks.push({ type: 'italic', text: lastLine })
    }
    return { title: '일러두기', blocks }
  }

  if (type === 'afterword') {
    const { glitchText, footnote } = parseAfterword(body)
    const blocks: Block[] = []
    if (glitchText) {
      blocks.push({ type: 'paragraph', text: glitchText })
    }
    if (footnote) {
      blocks.push({ type: 'divider' })
      blocks.push({ type: 'italic', text: footnote })
    }
    return { title: '후기', blocks }
  }

  // episode 또는 bonus → 풀 파서 사용
  return parseEpisodeBlocks(body)
}

// ── 메인 ──

async function main() {
  console.log('=== DeerDevil 에피소드 재파싱 시작 ===\n')

  // 1. MD 파일 로드 및 정렬
  console.log(`[1/4] MD 파일 로드 (${MD_DIR})`)
  const files = readdirSync(MD_DIR).filter((f) => f.endsWith('.md'))
  console.log(`  ${files.length}개 파일 발견`)

  const mdEntries: {
    filename: string
    type: string
    num?: string
    body: string
    sortKey: number
  }[] = []

  for (const file of files) {
    const content = readFileSync(join(MD_DIR, file), 'utf-8')
    const { frontmatter, body } = parseFrontmatter(content)
    mdEntries.push({
      filename: file,
      type: frontmatter.type,
      num: frontmatter.num,
      body,
      sortKey: sortOrder(frontmatter.type, frontmatter.num),
    })
  }

  // 정렬: preface → episode 1~12 → bonus → afterword
  mdEntries.sort((a, b) => a.sortKey - b.sortKey)

  console.log('  정렬 순서:')
  mdEntries.forEach((e, i) => {
    console.log(`    ${i + 1}. [${e.type}] ${e.filename}`)
  })

  // 2. DB에서 에피소드 목록 조회
  console.log('\n[2/4] DB 에피소드 조회...')
  const author = await prisma.author.findFirst({ where: { slug: AUTHOR_SLUG } })
  if (!author) throw new Error(`작가 '${AUTHOR_SLUG}'를 찾을 수 없습니다`)

  const work = await prisma.work.findFirst({
    where: { authorId: author.id, slug: WORK_SLUG },
  })
  if (!work) throw new Error(`작품 '${WORK_SLUG}'를 찾을 수 없습니다`)

  const episodes = await prisma.episode.findMany({
    where: { workId: work.id },
    orderBy: { orderNum: 'asc' },
  })
  console.log(`  ${episodes.length}개 에피소드 조회됨`)

  if (episodes.length !== mdEntries.length) {
    console.warn(
      `  ⚠ DB 에피소드 수(${episodes.length})와 MD 파일 수(${mdEntries.length})가 다릅니다`,
    )
  }

  // 3. 매핑 및 재파싱
  console.log('\n[3/4] 재파싱 및 DB 업데이트...')
  const blockTypeSummary: Record<string, number> = {}
  let updated = 0
  let failed = 0

  for (let i = 0; i < Math.min(episodes.length, mdEntries.length); i++) {
    const ep = episodes[i]
    const md = mdEntries[i]

    try {
      const { title, blocks } = parseBlocksByType(md.type, md.body)

      // 블록 타입 통계 수집
      for (const b of blocks) {
        blockTypeSummary[b.type] = (blockTypeSummary[b.type] || 0) + 1
        if (b.children) {
          for (const child of b.children) {
            blockTypeSummary[child.type] = (blockTypeSummary[child.type] || 0) + 1
          }
        }
      }

      // DB 업데이트
      await prisma.episode.update({
        where: { id: ep.id },
        data: { blocks: blocks as any },
      })

      updated++
      console.log(
        `  ✓ [${ep.slug}] ${ep.title} ← ${md.filename} (${blocks.length} blocks)`,
      )
    } catch (err: any) {
      failed++
      console.error(
        `  ✗ [${ep.slug}] ${ep.title} ← ${md.filename}: ${err.message}`,
      )
    }
  }

  // 4. 결과 출력
  console.log('\n[4/4] 결과 요약')
  console.log(`  업데이트: ${updated} / 실패: ${failed} / 전체: ${episodes.length}`)
  console.log('\n  블록 타입 분포:')

  const sorted = Object.entries(blockTypeSummary).sort((a, b) => b[1] - a[1])
  for (const [type, count] of sorted) {
    console.log(`    ${type}: ${count}`)
  }

  console.log('\n=== 완료 ===')
}

main()
  .catch((err) => {
    console.error('치명적 오류:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
