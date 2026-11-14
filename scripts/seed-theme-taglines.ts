/**
 * 작가별 tagline + dividerIcon 시드 스크립트
 *
 * 기존 테마의 overrides JSON에 tagline과 decorations.dividerIcon을 추가한다.
 * 멱등성 보장: 여러 번 실행해도 안전 (기존 overrides를 병합).
 *
 * 실행: DATABASE_URL="postgresql://..." npx tsx scripts/seed-theme-taglines.ts
 * 또는 .env 파일에 DATABASE_URL이 설정되어 있으면 자동으로 읽음
 */

import { PrismaClient } from '@prisma/client'
import { requireLocalSeedTarget } from '../src/infrastructure/config/local-seed-target'

// .env 파일 로드 시도
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config()
} catch {
  // dotenv 없으면 환경변수에서 직접 읽음
}

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL 환경변수가 필요합니다.')
  console.error('실행 예시: DATABASE_URL="postgresql://..." npx tsx scripts/seed-theme-taglines.ts')
  process.exit(1)
}

const prisma = new PrismaClient({
  datasources: { db: { url: requireLocalSeedTarget('DATABASE_URL', ['postgresql:', 'postgres:']) } },
})

// ── 작가별 tagline + dividerIcon 데이터 ──

interface TaglineData {
  slug: string
  tagline: string
  dividerIcon: string
}

const TAGLINE_DATA: TaglineData[] = [
  { slug: 'deerdevil',     tagline: '결핍은 질문을 삼킨다.',           dividerIcon: 'antler' },
  { slug: 'lee-gwangsu',   tagline: '사랑은 곧 눈물이다.',            dividerIcon: 'brush' },
  { slug: 'kim-sowol',     tagline: '나 보기가 역겨워 가실 때에는',     dividerIcon: 'flower' },
  { slug: 'yun-dongju',    tagline: '죽는 날까지 하늘을 우러러',       dividerIcon: 'star' },
  { slug: 'yi-sang',       tagline: '날개가 돋치다. 날자.',            dividerIcon: 'geometric' },
  { slug: 'chae-mansik',   tagline: '웃음 속에 칼이 있다.',            dividerIcon: 'brush' },
  { slug: 'lee-hyoseok',   tagline: '달빛에 숨은 메밀꽃',              dividerIcon: 'leaf' },
  { slug: 'kim-yujeong',   tagline: '봄이면 산골짝에',                 dividerIcon: 'camellia' },
  { slug: 'hyun-jingeon',  tagline: '운수 좋은 날이었다.',              dividerIcon: 'umbrella' },
  { slug: 'na-dohyang',    tagline: '물레방아는 돈다.',                 dividerIcon: 'waterwheel' },
]

async function main() {
  console.log('=== tagline + dividerIcon 시드 시작 ===\n')

  for (const data of TAGLINE_DATA) {
    // 작가 조회
    const author = await prisma.author.findUnique({
      where: { slug: data.slug },
      include: { themes: true },
    })

    if (!author) {
      console.log(`  [SKIP] ${data.slug} — 작가를 찾을 수 없음`)
      continue
    }

    const theme = author.themes[0]
    if (!theme) {
      console.log(`  [SKIP] ${data.slug} — 테마가 없음`)
      continue
    }

    // 기존 overrides 병합
    const existingOverrides = (theme.overrides as Record<string, unknown>) ?? {}
    const existingDecorations = (existingOverrides.decorations as Record<string, unknown>) ?? {}

    const updatedOverrides = {
      ...existingOverrides,
      tagline: data.tagline,
      decorations: {
        ...existingDecorations,
        dividerIcon: data.dividerIcon,
      },
    }

    await prisma.theme.update({
      where: { id: theme.id },
      data: { overrides: updatedOverrides },
    })

    console.log(`  [OK] ${data.slug}: tagline="${data.tagline}", dividerIcon="${data.dividerIcon}"`)
  }

  console.log('\n=== tagline + dividerIcon 시드 완료 ===')
}

main()
  .catch((e) => {
    console.error('시드 실패:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
